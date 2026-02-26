import type {
  CartTransformRunInput,
  CartTransformRunResult,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = { operations: [] };

type Slab = { min: number; max: number; amount: number; shipping: number; is_default_price?: boolean };
type ShippingRule = { mode?: string; amount?: number; percent?: number };
type PricingRule = {
  source: string;
  max_piece_area_sqft: number;
  overflow_markup: number;
  slab_pricing_mode?: string;
  slabs: Slab[];
  options?: Record<string, Record<string, number> | Record<string, ShippingRule>>;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isTruthy(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function extractChoiceLabel(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const idx = text.lastIndexOf(" - ");
  return idx > -1 ? text.slice(0, idx).trim() : text;
}

function toFeet(value: number, unitRaw: string): number {
  const unit = String(unitRaw || "").toLowerCase();
  if (unit === "ft") return value;
  if (unit === "m") return value * 3.28084;
  if (unit === "cm") return value * 0.0328084;
  if (unit === "mm") return value * 0.00328084;
  if (unit === "in" || unit === "inch" || unit === "inches") return value / 12;
  return NaN;
}

function parseSelectedOptions(raw: unknown): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "{}"));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    result[normalizeKey(k)] = String(v ?? "");
  }
  return result;
}

function parseRule(rawJsonValue: unknown, rawValue: unknown): PricingRule | null {
  const candidate = rawJsonValue ?? rawValue;
  if (!candidate) return null;

  let parsed: unknown = candidate;
  if (typeof candidate === "string") {
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rule = parsed as PricingRule;
  if (!rule.source || !Array.isArray(rule.slabs) || rule.slabs.length === 0) return null;
  return rule;
}

function compactLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") return "object";
  return String(value);
}


function resolveOptionPrice(
  groupConfig: Record<string, number> | undefined,
  selectedRaw: string,
): number {
  if (!groupConfig) return 0;
  const selectedLabel = extractChoiceLabel(selectedRaw);
  if (!selectedLabel) return 0;

  const selectedNormalized = normalizeKey(selectedLabel);
  for (const [optionKey, amount] of Object.entries(groupConfig)) {
    if (normalizeKey(optionKey) === selectedNormalized) {
      const num = Number(amount);
      return Number.isFinite(num) ? num : 0;
    }
  }
  return 0;
}

function resolveShippingPercent(
  shippingConfig: Record<string, ShippingRule> | undefined,
  selectedRaw: string,
): number {
  if (!shippingConfig) return 0;
  const selectedLabel = extractChoiceLabel(selectedRaw);
  const selectedNormalized = normalizeKey(selectedLabel);
  if (!selectedNormalized) return 0;

  for (const [key, rule] of Object.entries(shippingConfig)) {
    if (normalizeKey(key) !== selectedNormalized) continue;
    if (String(rule.mode || "").toLowerCase() !== "percent") return 0;
    const pct = Number(rule.percent ?? 0);
    return Number.isFinite(pct) && pct > 0 ? pct : 0;
  }

  // Fallback: if user selected a non-standard shipping option label that doesn't
  // exactly match config keys, apply available percent rule (typically Express).
  if (!selectedNormalized.includes("standard")) {
    for (const [key, rule] of Object.entries(shippingConfig)) {
      if (!normalizeKey(key).includes("express")) continue;
      if (String(rule.mode || "").toLowerCase() !== "percent") continue;
      const pct = Number(rule.percent ?? 0);
      if (Number.isFinite(pct) && pct > 0) return pct;
    }
    for (const rule of Object.values(shippingConfig)) {
      if (String(rule.mode || "").toLowerCase() !== "percent") continue;
      const pct = Number(rule.percent ?? 0);
      if (Number.isFinite(pct) && pct > 0) return pct;
    }
  }
  return 0;
}

function calculateTotal(
  rule: PricingRule,
  width: number,
  height: number,
  unit: string,
  pieces: number,
  optionsTotal: number,
  expressPercent: number,
): number | null {
  const widthFt = toFeet(width, unit);
  const heightFt = toFeet(height, unit);
  if (!Number.isFinite(widthFt) || !Number.isFinite(heightFt)) return null;

  const areaPerPieceSqFt = widthFt * heightFt;
  if (!Number.isFinite(areaPerPieceSqFt) || areaPerPieceSqFt <= 0) return null;

  const maxPieceAreaSqFt = Number(rule.max_piece_area_sqft || 900);
  if (areaPerPieceSqFt > maxPieceAreaSqFt) return null;

  const totalAreaSqFt = areaPerPieceSqFt * pieces;
  if (!Number.isFinite(totalAreaSqFt) || totalAreaSqFt <= 0) return null;

  const slabs = rule.slabs
    .map((s) => ({
      min: Number(s.min),
      max: Number(s.max),
      amount: Number(s.amount),
      shipping: Number(s.shipping ?? 0),
      is_default_price: Boolean(s.is_default_price),
    }))
    .filter((s) => Number.isFinite(s.min) && Number.isFinite(s.max) && Number.isFinite(s.amount) && Number.isFinite(s.shipping));

  if (slabs.length === 0) return null;

  const maxSlabMax = Math.max(...slabs.map((s) => s.max));
  let computed = 0;

  if (totalAreaSqFt > maxSlabMax) {
    const lastSlab = slabs[slabs.length - 1];
    const overflowMarkup = Number(rule.overflow_markup || 1.17);
    computed = totalAreaSqFt * lastSlab.amount * (Number.isFinite(overflowMarkup) ? overflowMarkup : 1.17);
  } else {
    let matched: (typeof slabs)[number] | null = null;
    for (const slab of slabs) {
      if (totalAreaSqFt >= slab.min && totalAreaSqFt <= slab.max) {
        matched = slab;
        break;
      }
    }
    if (!matched) return null;

    computed = matched.is_default_price
      ? matched.amount
      : totalAreaSqFt * matched.amount + matched.shipping;
  }

  const subtotal = computed + optionsTotal;
  const withShippingMode = subtotal + (subtotal * expressPercent) / 100;
  const rounded = Math.round(withShippingMode);
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
}

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  const operations: CartTransformRunResult["operations"] = [];

  for (const line of input.cart.lines as any[]) {
    const debugEnabled = isTruthy(line.debugFlag?.value ?? "");
    const lineRef = String(line?.id ?? "unknown");
    const debugLog = (step: string, data?: Record<string, unknown>) => {
      if (!debugEnabled) return;
      const compactData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data || {})) {
        compactData[k] = compactLogValue(v);
      }
      try {
        console.error(JSON.stringify({ tag: "cp_debug", step, lineId: lineRef, ...compactData }));
      } catch {
        console.error(`[cp_debug] step=${step} lineId=${lineRef}`);
      }
    };

    const baseTitle = String(line?.merchandise?.product?.title || line?.merchandise?.title || "Custom item");
    const pushDebugSkip = (reason: string) => {
      if (!debugEnabled) return;
      debugLog("skip", { reason, baseTitle });
      operations.push({
        lineUpdate: {
          cartLineId: line.id,
          title: `${baseTitle} [APP:skip:${reason}]`,
        },
      });
    };

    const source = String(line.source?.value ?? "");
    debugLog("line_start", {
      source,
      qty: line.quantity,
      piecesRaw: line.pieces?.value ?? "",
      pricingVersionRaw: line.pricingVersion?.value ?? "",
    });

    if (!source) {
      pushDebugSkip("missing_source");
      continue;
    }

    const pieces = toNumber(line.pieces?.value ?? "");
    const qty = toNumber(line.quantity);
    const pricingVersion = String(line.pricingVersion?.value ?? "");
    debugLog("parsed_core_attrs", { source, pieces, qty, pricingVersion });

    if (!Number.isFinite(pieces) || pieces <= 0) {
      pushDebugSkip("invalid_pieces");
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty !== pieces) {
      pushDebugSkip("qty_mismatch");
      continue;
    }
    if (pricingVersion !== "v1") {
      pushDebugSkip("bad_pricing_version");
      continue;
    }

    const width = toNumber(line.width?.value ?? "");
    const height = toNumber(line.height?.value ?? "");
    const unit = String(line.unit?.value ?? "");
    debugLog("parsed_dimensions", { width, height, unit });
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !unit) {
      pushDebugSkip("invalid_dimensions");
      continue;
    }

    const computedTotalFromCart = toNumber(line.computedTotal?.value ?? "");
    const rule = parseRule(
      line?.merchandise?.product?.pricingRuleJson?.jsonValue,
      line?.merchandise?.product?.pricingRuleJson?.value,
    );
    debugLog("rule_lookup", {
      hasRule: Boolean(rule),
      computedTotalFromCart,
    });

    let computedTotalFromRule: number | null = null;

    if (rule) {
      debugLog("rule_loaded", {
        ruleSource: rule.source,
        slabs: rule.slabs?.length ?? 0,
        hasOptions: Boolean(rule.options && Object.keys(rule.options).length),
      });
      if (String(rule.source) !== source) {
        pushDebugSkip("source_mismatch");
        continue;
      }

      const selectedOptions = parseSelectedOptions(line.selectedOptions?.value ?? "{}");
      let optionsTotal = 0;
      let expressPercent = 0;

      for (const [groupName, config] of Object.entries(rule.options || {})) {
        const selectedRaw = selectedOptions[normalizeKey(groupName)] ?? "";
        if (normalizeKey(groupName).includes("shipping")) {
          expressPercent = resolveShippingPercent(config as Record<string, ShippingRule>, selectedRaw);
        } else {
          optionsTotal += resolveOptionPrice(config as Record<string, number>, selectedRaw);
        }
      }
      debugLog("options_evaluated", { optionsTotal, expressPercent });

      computedTotalFromRule = calculateTotal(rule, width, height, unit, pieces, optionsTotal, expressPercent);
      debugLog("rule_total_result", { computedTotalFromRule });
    }

    if (!rule && !(computedTotalFromCart > 0)) {
      pushDebugSkip("missing_rule_and_computed_total");
      continue;
    }

    const computedTotal = computedTotalFromRule || (computedTotalFromCart > 0 ? computedTotalFromCart : null);
    debugLog("total_resolution", {
      fromRule: computedTotalFromRule,
      fromCart: computedTotalFromCart,
      finalComputedTotal: computedTotal,
    });
    if (!computedTotal) {
      pushDebugSkip("no_computed_total");
      continue;
    }

    const unitPrice = +(computedTotal / pieces).toFixed(2);
    debugLog("unit_price", { unitPrice, pieces, computedTotal });
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      pushDebugSkip("invalid_unit_price");
      continue;
    }

    const debugSource = computedTotalFromRule ? "rule" : "cart";
    const debugTitle = debugEnabled ? `${baseTitle} [APP:${debugSource}:${computedTotal}]` : undefined;

    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        ...(debugTitle ? { title: debugTitle } : {}),
        price: {
          adjustment: {
            fixedPricePerUnit: { amount: unitPrice.toFixed(2) },
          },
        },
      },
    });
    debugLog("line_update_added", { debugSource, computedTotal, unitPrice });
  }

  if (operations.length === 0) return NO_CHANGES;
  return { operations };
}
