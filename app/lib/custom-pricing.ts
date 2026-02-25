export type PricingSource = "polyester_fabric_section" | "biodegradable_fabric_section";

type Slab = {
  min: number;
  max: number;
  amount: number;
  shipping: number;
  isDefaultPrice?: boolean;
};

type SlabMetric = "total_area_sqft" | "width_ft";
type SlabPricingMode = "rate" | "flat_per_piece";
type OverflowMode = "last_slab_rate" | "width_unit_rate";

type SourceConfig = {
  maxPieceAreaSqFt: number;
  overflowMarkup: number;
  slabs: Slab[];
  shippingSurcharge?: number;
  options?: Record<string, number>;
  slabMetric?: SlabMetric;
  slabPricingMode?: SlabPricingMode;
  overflowMode?: OverflowMode;
  overflowUnitRate?: number;
};

const SOURCE_CONFIG: Record<PricingSource, SourceConfig> = {
  polyester_fabric_section: {
    maxPieceAreaSqFt: 900,
    overflowMarkup: 1.17,
    slabMetric: "total_area_sqft",
    slabPricingMode: "rate",
    overflowMode: "last_slab_rate",
    slabs: [
      { min: 0, max: 100, amount: 4.5, shipping: 0 },
      { min: 100.000001, max: 500, amount: 3.9, shipping: 0 },
      { min: 500.000001, max: 100000, amount: 3.4, shipping: 0 },
    ],
  },
  biodegradable_fabric_section: {
    maxPieceAreaSqFt: 900,
    overflowMarkup: 1.2,
    slabMetric: "total_area_sqft",
    slabPricingMode: "rate",
    overflowMode: "last_slab_rate",
    slabs: [
      { min: 0, max: 100, amount: 5.2, shipping: 0 },
      { min: 100.000001, max: 500, amount: 4.6, shipping: 0 },
      { min: 500.000001, max: 100000, amount: 4.1, shipping: 0 },
    ],
  },
};

type Unit = "ft" | "m" | "cm" | "mm" | "in" | "inch" | "inches";

export type PricingInput = {
  source: string;
  width: number;
  height: number;
  unit: string;
  pieces: number;
  optionAmounts?: number[];
};

export type PricingResult =
  | {
      ok: true;
      total: number;
      unitPrice: number;
      areaPerPieceSqFt: number;
      totalAreaSqFt: number;
      source: PricingSource;
      pieces: number;
    }
  | { ok: false; reason: string };

function toSqFt(value: number, unitRaw: string): number {
  const unit = (unitRaw || "").toLowerCase() as Unit;
  switch (unit) {
    case "ft":
      return value;
    case "m":
      return value * 3.28084;
    case "cm":
      return value * 0.0328084;
    case "mm":
      return value * 0.00328084;
    case "in":
    case "inch":
    case "inches":
      return value / 12;
    default:
      return NaN;
  }
}

function isSupportedSource(source: string): source is PricingSource {
  return source === "polyester_fabric_section" || source === "biodegradable_fabric_section";
}

function findSlab(area: number, slabs: Slab[]): Slab | null {
  for (const slab of slabs) {
    if (area >= slab.min && area <= slab.max) return slab;
  }
  return null;
}

export type ExternalPricingRule = {
  source: string;
  max_piece_area_sqft?: number;
  overflow_markup?: number;
  slab_metric?: SlabMetric;
  slab_pricing_mode?: SlabPricingMode;
  overflow_mode?: OverflowMode;
  overflow_unit_rate?: number;
  slabs: Array<{
    min: number;
    max: number;
    amount: number;
    shipping?: number;
    is_default_price?: boolean;
  }>;
  shipping_surcharge?: number;
  options?: Record<string, number>;
};

function normalizeRule(rule: ExternalPricingRule): SourceConfig | null {
  if (!rule || !Array.isArray(rule.slabs) || rule.slabs.length === 0) return null;
  const slabs: Slab[] = rule.slabs.map((s) => ({
    min: Number(s.min),
    max: Number(s.max),
    amount: Number(s.amount),
    shipping: Number(s.shipping ?? 0),
    isDefaultPrice: Boolean(s.is_default_price),
  }));
  if (slabs.some((s) => !Number.isFinite(s.min) || !Number.isFinite(s.max) || !Number.isFinite(s.amount))) {
    return null;
  }
  return {
    maxPieceAreaSqFt: Number(rule.max_piece_area_sqft ?? 900),
    overflowMarkup: Number(rule.overflow_markup ?? 1.17),
    slabs,
    shippingSurcharge: Number(rule.shipping_surcharge ?? 0),
    options: rule.options || {},
    slabMetric:
      rule.slab_metric === "width_ft" || rule.slab_metric === "total_area_sqft"
        ? rule.slab_metric
        : "total_area_sqft",
    slabPricingMode:
      rule.slab_pricing_mode === "flat_per_piece" || rule.slab_pricing_mode === "rate"
        ? rule.slab_pricing_mode
        : "rate",
    overflowMode:
      rule.overflow_mode === "width_unit_rate" || rule.overflow_mode === "last_slab_rate"
        ? rule.overflow_mode
        : "last_slab_rate",
    overflowUnitRate: Number(rule.overflow_unit_rate ?? NaN),
  };
}

export function computeTrustedPrice(input: PricingInput, overrideRule?: ExternalPricingRule): PricingResult {
  if (!isSupportedSource(input.source)) {
    return { ok: false, reason: "unsupported_source" };
  }

  const width = Number(input.width);
  const height = Number(input.height);
  const pieces = Number(input.pieces);
  const unit = String(input.unit || "");

  if (!Number.isFinite(width) || width <= 0) return { ok: false, reason: "invalid_width" };
  if (!Number.isFinite(height) || height <= 0) return { ok: false, reason: "invalid_height" };
  if (!Number.isFinite(pieces) || pieces <= 0) return { ok: false, reason: "invalid_pieces" };

  const widthSqFtBase = toSqFt(width, unit);
  const heightSqFtBase = toSqFt(height, unit);
  if (!Number.isFinite(widthSqFtBase) || !Number.isFinite(heightSqFtBase)) {
    return { ok: false, reason: "invalid_unit" };
  }

  const areaPerPieceSqFt = widthSqFtBase * heightSqFtBase;
  if (!Number.isFinite(areaPerPieceSqFt) || areaPerPieceSqFt <= 0) {
    return { ok: false, reason: "invalid_area" };
  }

  const cfg = overrideRule ? normalizeRule(overrideRule) : SOURCE_CONFIG[input.source];
  if (!cfg) return { ok: false, reason: "invalid_rule_config" };
  if (areaPerPieceSqFt > cfg.maxPieceAreaSqFt) {
    return { ok: false, reason: "area_limit_exceeded" };
  }

  const totalAreaSqFt = areaPerPieceSqFt * pieces;
  const slabMetric = cfg.slabMetric || "total_area_sqft";
  const slabPricingMode = cfg.slabPricingMode || "rate";
  const overflowMode = cfg.overflowMode || "last_slab_rate";
  const metricValuePerPiece = slabMetric === "width_ft" ? widthSqFtBase : areaPerPieceSqFt;
  const metricValueTotal = slabMetric === "width_ft" ? widthSqFtBase * pieces : totalAreaSqFt;
  const maxSlabMax = Math.max(...cfg.slabs.map((s) => s.max));
  const lastSlab = cfg.slabs[cfg.slabs.length - 1];

  let total = 0;
  if (metricValuePerPiece > maxSlabMax) {
    if (overflowMode === "width_unit_rate" && Number.isFinite(cfg.overflowUnitRate)) {
      total = widthSqFtBase * Number(cfg.overflowUnitRate) * cfg.overflowMarkup * pieces;
    } else {
      total = metricValueTotal * lastSlab.amount * cfg.overflowMarkup;
    }
  } else {
    const slab = findSlab(metricValuePerPiece, cfg.slabs);
    if (!slab) return { ok: false, reason: "no_matching_slab" };
    if (slabPricingMode === "flat_per_piece") {
      total = (slab.amount + slab.shipping) * pieces;
    } else if (slab.isDefaultPrice) {
      total = slab.amount;
    } else {
      total = metricValueTotal * slab.amount + slab.shipping;
    }
  }

  const optionAmounts = Array.isArray(input.optionAmounts) ? input.optionAmounts : [];
  const optionsTotal = optionAmounts.reduce((sum, value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return sum;
    return sum + amount;
  }, 0);
  total += optionsTotal;
  total += Number(cfg.shippingSurcharge || 0);

  const roundedTotal = Math.round(total);
  if (!Number.isFinite(roundedTotal) || roundedTotal <= 0) {
    return { ok: false, reason: "invalid_total" };
  }

  const unitPrice = Number((roundedTotal / pieces).toFixed(2));
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return { ok: false, reason: "invalid_unit_price" };
  }

  return {
    ok: true,
    total: roundedTotal,
    unitPrice,
    areaPerPieceSqFt,
    totalAreaSqFt,
    source: input.source,
    pieces,
  };
}
