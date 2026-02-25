import type { ExternalPricingRule } from "./custom-pricing";

type AdminClient = {
  graphql: (query: string, init?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

function parseJsonField(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function getProductPricingRule(
  admin: AdminClient,
  productId: string,
): Promise<ExternalPricingRule | null> {
  const response = await admin.graphql(
    `#graphql
    query ProductPricingRule($id: ID!) {
      product(id: $id) {
        id
        metafield(namespace: "custom", key: "pricing_rule") {
          reference {
            ... on Metaobject {
              id
              type
              fields {
                key
                value
              }
            }
          }
        }
      }
    }`,
    { variables: { id: productId } },
  );

  const json = await response.json();
  const fields =
    json?.data?.product?.metafield?.reference?.fields?.reduce((acc: Record<string, string>, f: any) => {
      if (f?.key) acc[f.key] = f.value;
      return acc;
    }, {}) || null;

  if (!fields) return null;

  const slabs = parseJsonField(fields.slabs_json);
  if (!Array.isArray(slabs) || slabs.length === 0) return null;

  const options = parseJsonField(fields.options_json);
  const active = String(fields.active || "true").toLowerCase() !== "false";
  if (!active) return null;

  return {
    source: fields.source || "",
    max_piece_area_sqft: Number(fields.max_piece_area_sqft || 900),
    overflow_markup: Number(fields.overflow_markup || 1.17),
    slab_metric: (fields.slab_metric || "total_area_sqft") as "total_area_sqft" | "width_ft",
    slab_pricing_mode: (fields.slab_pricing_mode || "rate") as "rate" | "flat_per_piece",
    overflow_mode: (fields.overflow_mode || "last_slab_rate") as "last_slab_rate" | "width_unit_rate",
    overflow_unit_rate: Number(fields.overflow_unit_rate || NaN),
    slabs,
    shipping_surcharge: Number(fields.shipping_surcharge || 0),
    options: options && typeof options === "object" ? options : {},
  };
}
