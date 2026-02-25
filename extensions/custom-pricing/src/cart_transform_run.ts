import type {
  CartTransformRunInput,
  CartTransformRunResult,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

type PricingSource = "polyester_fabric_section" | "biodegradable_fabric_section";
type Slab = { min: number; max: number; amount: number; shipping: number; isDefaultPrice?: boolean };
type SourceConfig = { maxPieceAreaSqFt: number; overflowMarkup: number; slabs: Slab[] };

const SOURCE_CONFIG: Record<PricingSource, SourceConfig> = {
  polyester_fabric_section: {
    maxPieceAreaSqFt: 900,
    overflowMarkup: 1.17,
    slabs: [
      { min: 0, max: 100, amount: 4.5, shipping: 0 },
      { min: 100.000001, max: 500, amount: 3.9, shipping: 0 },
      { min: 500.000001, max: 100000, amount: 3.4, shipping: 0 },
    ],
  },
  biodegradable_fabric_section: {
    maxPieceAreaSqFt: 900,
    overflowMarkup: 1.2,
    slabs: [
      { min: 0, max: 100, amount: 5.2, shipping: 0 },
      { min: 100.000001, max: 500, amount: 4.6, shipping: 0 },
      { min: 500.000001, max: 100000, amount: 4.1, shipping: 0 },
    ],
  },
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isSupportedSource(source: string): source is PricingSource {
  return source === "polyester_fabric_section" || source === "biodegradable_fabric_section";
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

function calculateTotal(
  source: PricingSource,
  width: number,
  height: number,
  unit: string,
  pieces: number,
): number | null {
  const widthFt = toFeet(width, unit);
  const heightFt = toFeet(height, unit);
  if (!Number.isFinite(widthFt) || !Number.isFinite(heightFt)) return null;

  const areaPerPieceSqFt = widthFt * heightFt;
  if (!Number.isFinite(areaPerPieceSqFt) || areaPerPieceSqFt <= 0) return null;

  const config = SOURCE_CONFIG[source];
  if (areaPerPieceSqFt > config.maxPieceAreaSqFt) return null;

  const totalAreaSqFt = areaPerPieceSqFt * pieces;
  if (!Number.isFinite(totalAreaSqFt) || totalAreaSqFt <= 0) return null;

  const maxSlabMax = Math.max(...config.slabs.map((slab) => slab.max));
  const lastSlab = config.slabs[config.slabs.length - 1];

  let computed = 0;
  if (totalAreaSqFt > maxSlabMax) {
    computed = totalAreaSqFt * lastSlab.amount * config.overflowMarkup;
  } else {
    let matched: Slab | null = null;
    for (const slab of config.slabs) {
      if (totalAreaSqFt >= slab.min && totalAreaSqFt <= slab.max) {
        matched = slab;
        break;
      }
    }
    if (!matched) return null;
    computed = matched.isDefaultPrice
      ? matched.amount
      : totalAreaSqFt * matched.amount + matched.shipping;
  }

  const rounded = Math.round(computed);
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
}

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  const operations: CartTransformRunResult["operations"] = [];
  let skippedNotScoped = 0;
  let skippedInvalidInputs = 0;
  let skippedVersionMismatch = 0;
  let skippedQuantityMismatch = 0;
  let skippedNoPrice = 0;
  let skippedLineErrors = 0;
  let updatedLines = 0;

  console.error(
    `[custom-pricing] start lines=${input.cart.lines.length}`,
  );

  for (const line of input.cart.lines) {
    try {
      const typedLine = line as any;
      const rawSource = typedLine.source?.value ?? "";
      if (!isSupportedSource(rawSource)) {
        skippedNotScoped += 1;
        continue;
      }

      const rawPieces = typedLine.pieces?.value ?? "";
      const pieces = toNumber(rawPieces);
      if (!Number.isFinite(pieces) || pieces <= 0) {
        skippedInvalidInputs += 1;
        continue;
      }

      const pricingVersion = String(typedLine.pricingVersion?.value ?? "");
      if (pricingVersion !== "v1") {
        skippedVersionMismatch += 1;
        continue;
      }

      const lineQty = toNumber((line as any).quantity);
      if (!Number.isFinite(lineQty) || lineQty <= 0 || lineQty !== pieces) {
        skippedQuantityMismatch += 1;
        continue;
      }

      const width = toNumber(typedLine.width?.value ?? "");
      const height = toNumber(typedLine.height?.value ?? "");
      const unit = String(typedLine.unit?.value ?? "");
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !unit) {
        skippedInvalidInputs += 1;
        continue;
      }

      const computedTotal = calculateTotal(rawSource, width, height, unit, pieces);
      if (!computedTotal) {
        skippedNoPrice += 1;
        continue;
      }

      const appliedUnitPrice = +(computedTotal / pieces).toFixed(2);
      if (!Number.isFinite(appliedUnitPrice) || appliedUnitPrice <= 0) continue;

      operations.push({
        lineUpdate: {
          cartLineId: line.id,
          price: {
            adjustment: {
              fixedPricePerUnit: {
                amount: appliedUnitPrice.toFixed(2),
              },
            },
          },
        },
      });
      updatedLines += 1;
    } catch (error) {
      skippedLineErrors += 1;
      console.error(
        `[custom-pricing] skip line=${line.id}: unexpected error`,
        error,
      );
      continue;
    }
  }

  console.error(
    `[custom-pricing] summary lines=${input.cart.lines.length} updates=${updatedLines} skipped_not_scoped=${skippedNotScoped} skipped_invalid_inputs=${skippedInvalidInputs} skipped_version_mismatch=${skippedVersionMismatch} skipped_quantity_mismatch=${skippedQuantityMismatch} skipped_no_price=${skippedNoPrice} skipped_line_errors=${skippedLineErrors}`,
  );

  if (operations.length === 0) return NO_CHANGES;
  return { operations };
};
