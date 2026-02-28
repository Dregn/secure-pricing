const METAOBJECT_TYPE = "pricing_rule";
const PRODUCT_NAMESPACE = "$app:pricing";
const PRODUCT_RULE_KEY = "pricing_rule";
const PRODUCT_RULE_JSON_KEY = "pricing_rule_json";
const PRODUCT_RULE_JSON_BACKUP_KEY = "pricing_rule_json_backup";

type AdminClient = {
  graphql: (query: string, init?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type PricingRuleInput = {
  id?: string;
  ruleName: string;
  source: string;
  maxPieceAreaSqFt: number;
  overflowMarkup: number;
  slabMetric: "total_area_sqft" | "width_ft";
  slabPricingMode: "rate" | "flat_per_piece";
  overflowMode: "last_slab_rate" | "width_unit_rate";
  overflowUnitRate?: number | null;
  slabs: Array<{
    min: number;
    max: number;
    amount: number;
    shipping?: number;
    is_default_price?: boolean;
  }>;
  options: Record<string, unknown>;
  shippingSurcharge: number;
  active: boolean;
  productIds: string[];
};

export type PricingRuleListItem = {
  id: string;
  handle: string;
  updatedAt: string;
  ruleName: string;
  source: string;
  linkedProducts: Array<{ id: string; title: string }>;
};

type ProductOption = {
  id: string;
  title: string;
};

function assertGraphqlSuccess(payload: any, path: string): void {
  const op = payload?.data?.[path];
  const userErrors = op?.userErrors;
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    const message = userErrors.map((e: any) => e?.message).filter(Boolean).join("; ");
    throw new Error(message || `Shopify user error in ${path}`);
  }
}

function toFieldsObject(fields: Array<{ key: string; value: string }>): Record<string, string> {
  return fields.reduce(
    (acc, field) => {
      if (field?.key) acc[field.key] = field.value ?? "";
      return acc;
    },
    {} as Record<string, string>,
  );
}

function parseJsonField<T>(value: string, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function toNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolean(value: string | undefined, fallback = true): boolean {
  if (value == null) return fallback;
  const normalized = String(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function buildMetaobjectFields(input: PricingRuleInput, includeRuleName: boolean) {
  const fields: Array<{ key: string; value: string }> = [
    { key: "source", value: input.source },
    { key: "max_piece_area_sqft", value: String(input.maxPieceAreaSqFt) },
    { key: "overflow_markup", value: String(input.overflowMarkup) },
    { key: "slab_metric", value: input.slabMetric },
    { key: "slab_pricing_mode", value: input.slabPricingMode },
    { key: "overflow_mode", value: input.overflowMode },
    { key: "slabs_json", value: JSON.stringify(input.slabs) },
    { key: "options_json", value: JSON.stringify(input.options || {}) },
    { key: "shipping_surcharge", value: String(input.shippingSurcharge) },
    { key: "active", value: String(input.active) },
  ];

  if (includeRuleName) {
    fields.unshift({ key: "rule_name", value: input.ruleName });
  }

  if (Number.isFinite(Number(input.overflowUnitRate))) {
    fields.push({ key: "overflow_unit_rate", value: String(input.overflowUnitRate) });
  }

  return fields;
}

function mapMetaobjectToRule(node: any): PricingRuleInput {
  const fields = toFieldsObject(node?.fields || []);
  const slabs = parseJsonField<Array<PricingRuleInput["slabs"][number]>>(fields.slabs_json, []);
  const options = parseJsonField<Record<string, unknown>>(fields.options_json, {});

  return {
    id: String(node.id),
    ruleName: String(fields.rule_name || ""),
    source: String(fields.source || ""),
    maxPieceAreaSqFt: toNumber(fields.max_piece_area_sqft, 900),
    overflowMarkup: toNumber(fields.overflow_markup, 1.17),
    slabMetric: fields.slab_metric === "width_ft" ? "width_ft" : "total_area_sqft",
    slabPricingMode: fields.slab_pricing_mode === "flat_per_piece" ? "flat_per_piece" : "rate",
    overflowMode: fields.overflow_mode === "width_unit_rate" ? "width_unit_rate" : "last_slab_rate",
    overflowUnitRate:
      fields.overflow_unit_rate && String(fields.overflow_unit_rate).trim() !== ""
        ? toNumber(fields.overflow_unit_rate, NaN)
        : null,
    slabs: Array.isArray(slabs) ? slabs : [],
    options: options && typeof options === "object" ? options : {},
    shippingSurcharge: toNumber(fields.shipping_surcharge, 0),
    active: toBoolean(fields.active, true),
    productIds: [],
  };
}

export function validatePricingRuleInput(input: PricingRuleInput): string[] {
  const errors: string[] = [];
  if (!input.ruleName || !input.ruleName.trim()) errors.push("Rule Name is required.");
  if (!input.source || !input.source.trim()) errors.push("Source is required.");
  if (!Array.isArray(input.slabs)) errors.push("Slabs JSON must be an array.");
  if (typeof input.options !== "object" || Array.isArray(input.options) || input.options === null) {
    errors.push("Options JSON must be an object.");
  }

  return errors;
}

export async function listPricingRules(
  admin: AdminClient,
): Promise<{ rules: PricingRuleListItem[]; products: ProductOption[] }> {
  const [rulesRes, productsRes] = await Promise.all([
    admin.graphql(
      `#graphql
      query PricingRulesList {
        metaobjects(type: "${METAOBJECT_TYPE}", first: 100, sortKey: "updated_at", reverse: true) {
          nodes {
            id
            handle
            updatedAt
            fields {
              key
              value
            }
          }
        }
      }`,
    ),
    admin.graphql(
      `#graphql
      query ProductsForPricingRules {
        products(first: 250) {
          nodes {
            id
            title
            metafield(namespace: "${PRODUCT_NAMESPACE}", key: "${PRODUCT_RULE_KEY}") {
              reference {
                ... on Metaobject {
                  id
                }
              }
            }
          }
        }
      }`,
    ),
  ]);

  const rulesPayload = await rulesRes.json();
  const productsPayload = await productsRes.json();
  const rawRules = rulesPayload?.data?.metaobjects?.nodes || [];
  const rawProducts = productsPayload?.data?.products?.nodes || [];

  const products: ProductOption[] = rawProducts.map((p: any) => ({
    id: String(p.id),
    title: String(p.title),
  }));

  const ruleIdToProducts = new Map<string, Array<{ id: string; title: string }>>();
  for (const product of rawProducts) {
    const refId = product?.metafield?.reference?.id;
    if (!refId) continue;
    const list = ruleIdToProducts.get(refId) || [];
    list.push({ id: String(product.id), title: String(product.title) });
    ruleIdToProducts.set(refId, list);
  }

  const rules: PricingRuleListItem[] = rawRules.map((rule: any) => {
    const fields = toFieldsObject(rule.fields || []);
    return {
      id: String(rule.id),
      handle: String(rule.handle),
      updatedAt: String(rule.updatedAt),
      ruleName: String(fields.rule_name || ""),
      source: String(fields.source || ""),
      linkedProducts: ruleIdToProducts.get(String(rule.id)) || [],
    };
  });

  return { rules, products };
}

export async function getPricingRuleById(
  admin: AdminClient,
  ruleId: string,
): Promise<PricingRuleInput | null> {
  const [ruleRes, productsRes] = await Promise.all([
    admin.graphql(
      `#graphql
      query RuleById($id: ID!) {
        node(id: $id) {
          ... on Metaobject {
            id
            type
            fields {
              key
              value
            }
          }
        }
      }`,
      { variables: { id: ruleId } },
    ),
    admin.graphql(
      `#graphql
      query LinkedProductsByRule {
        products(first: 250) {
          nodes {
            id
            metafield(namespace: "${PRODUCT_NAMESPACE}", key: "${PRODUCT_RULE_KEY}") {
              reference {
                ... on Metaobject {
                  id
                }
              }
            }
          }
        }
      }`,
    ),
  ]);

  const rulePayload = await ruleRes.json();
  const productsPayload = await productsRes.json();
  const node = rulePayload?.data?.node;
  if (!node || node.type !== METAOBJECT_TYPE) return null;

  const rule = mapMetaobjectToRule(node);
  const linkedIds: string[] = (productsPayload?.data?.products?.nodes || [])
    .filter((p: any) => p?.metafield?.reference?.id === ruleId)
    .map((p: any) => String(p.id));
  rule.productIds = linkedIds;
  return rule;
}

async function readProductRuleJson(
  admin: AdminClient,
  productIds: string[],
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const response = await admin.graphql(
    `#graphql
    query ExistingProductRuleJson($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          pricingRuleJson: metafield(namespace: "${PRODUCT_NAMESPACE}", key: "${PRODUCT_RULE_JSON_KEY}") {
            value
          }
        }
      }
    }`,
    { variables: { ids: productIds } },
  );
  const payload = await response.json();
  const map = new Map<string, string>();
  for (const node of payload?.data?.nodes || []) {
    if (!node?.id) continue;
    map.set(String(node.id), String(node?.pricingRuleJson?.value || ""));
  }
  return map;
}

async function setProductMetafields(
  admin: AdminClient,
  productId: string,
  ruleMetaobjectId: string,
  ruleJson: string,
  previousRuleJsonRaw: string,
): Promise<void> {
  let previousParsed: unknown = null;
  if (previousRuleJsonRaw) {
    try {
      previousParsed = JSON.parse(previousRuleJsonRaw);
    } catch {
      previousParsed = previousRuleJsonRaw;
    }
  }
  const backupValue = JSON.stringify({
    saved_at: new Date().toISOString(),
    previous: previousParsed,
  });
  const response = await admin.graphql(
    `#graphql
    mutation SetProductPricingMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: PRODUCT_NAMESPACE,
            key: PRODUCT_RULE_KEY,
            type: "metaobject_reference",
            value: ruleMetaobjectId,
          },
          {
            ownerId: productId,
            namespace: PRODUCT_NAMESPACE,
            key: PRODUCT_RULE_JSON_BACKUP_KEY,
            type: "json",
            value: backupValue,
          },
          {
            ownerId: productId,
            namespace: PRODUCT_NAMESPACE,
            key: PRODUCT_RULE_JSON_KEY,
            type: "json",
            value: ruleJson,
          },
        ],
      },
    },
  );
  const payload = await response.json();
  assertGraphqlSuccess(payload, "metafieldsSet");
}

async function setProductRuleReference(
  admin: AdminClient,
  productId: string,
  ruleMetaobjectId: string,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
    mutation SetProductRuleReference($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: PRODUCT_NAMESPACE,
            key: PRODUCT_RULE_KEY,
            type: "metaobject_reference",
            value: ruleMetaobjectId,
          },
        ],
      },
    },
  );
  const payload = await response.json();
  assertGraphqlSuccess(payload, "metafieldsSet");
}

async function deleteProductMetafields(admin: AdminClient, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  const metafields: Array<{ ownerId: string; namespace: string; key: string }> = [];
  for (const productId of productIds) {
    metafields.push({ ownerId: productId, namespace: PRODUCT_NAMESPACE, key: PRODUCT_RULE_KEY });
    metafields.push({ ownerId: productId, namespace: PRODUCT_NAMESPACE, key: PRODUCT_RULE_JSON_KEY });
  }
  const response = await admin.graphql(
    `#graphql
    mutation RemovePricingMetafields($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields {
          key
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { metafields } },
  );
  const payload = await response.json();
  assertGraphqlSuccess(payload, "metafieldsDelete");
}

export async function createPricingRule(
  admin: AdminClient,
  input: PricingRuleInput,
  options?: { autoSync?: boolean },
): Promise<{ id: string; synced: number }> {
  const fields = buildMetaobjectFields(input, true);
  const handle = `${slugify(input.ruleName)}-${Date.now()}`;
  const createRes = await admin.graphql(
    `#graphql
    mutation CreatePricingRule($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metaobject: {
          type: METAOBJECT_TYPE,
          handle,
          fields,
        },
      },
    },
  );
  const createPayload = await createRes.json();
  assertGraphqlSuccess(createPayload, "metaobjectCreate");
  const id = String(createPayload?.data?.metaobjectCreate?.metaobject?.id || "");
  if (!id) throw new Error("Pricing rule was not created.");

  const ruleForJson = {
    rule_name: input.ruleName,
    source: input.source,
    max_piece_area_sqft: input.maxPieceAreaSqFt,
    overflow_markup: input.overflowMarkup,
    slab_metric: input.slabMetric,
    slab_pricing_mode: input.slabPricingMode,
    overflow_mode: input.overflowMode,
    overflow_unit_rate: input.overflowUnitRate,
    slabs: input.slabs,
    options: input.options,
    shipping_surcharge: input.shippingSurcharge,
    active: input.active,
  };
  const autoSync = Boolean(options?.autoSync);
  const ruleJson = JSON.stringify(ruleForJson);
  const previousRuleJson = autoSync ? await readProductRuleJson(admin, input.productIds) : new Map<string, string>();
  for (const productId of input.productIds) {
    if (autoSync) {
      await setProductMetafields(admin, productId, id, ruleJson, previousRuleJson.get(productId) || "");
    } else {
      await setProductRuleReference(admin, productId, id);
    }
  }
  return { id, synced: autoSync ? input.productIds.length : 0 };
}

export async function updatePricingRule(
  admin: AdminClient,
  ruleId: string,
  input: PricingRuleInput,
  options?: { autoSync?: boolean },
): Promise<{ synced: number }> {
  const current = await getPricingRuleById(admin, ruleId);
  if (!current) throw new Error("Rule not found.");

  const fields = buildMetaobjectFields(input, false);
  const updateRes = await admin.graphql(
    `#graphql
    mutation UpdatePricingRule($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { id: ruleId, metaobject: { fields } } },
  );
  const updatePayload = await updateRes.json();
  assertGraphqlSuccess(updatePayload, "metaobjectUpdate");

  const nextIds = Array.from(new Set(input.productIds));
  const prevIds = Array.from(new Set(current.productIds));
  const removedIds = prevIds.filter((id) => !nextIds.includes(id));
  const ruleForJson = {
    rule_name: current.ruleName,
    source: input.source,
    max_piece_area_sqft: input.maxPieceAreaSqFt,
    overflow_markup: input.overflowMarkup,
    slab_metric: input.slabMetric,
    slab_pricing_mode: input.slabPricingMode,
    overflow_mode: input.overflowMode,
    overflow_unit_rate: input.overflowUnitRate,
    slabs: input.slabs,
    options: input.options,
    shipping_surcharge: input.shippingSurcharge,
    active: input.active,
  };
  const autoSync = Boolean(options?.autoSync);
  const ruleJson = JSON.stringify(ruleForJson);
  const previousRuleJson = autoSync ? await readProductRuleJson(admin, nextIds) : new Map<string, string>();
  for (const productId of nextIds) {
    if (autoSync) {
      await setProductMetafields(admin, productId, ruleId, ruleJson, previousRuleJson.get(productId) || "");
    } else {
      await setProductRuleReference(admin, productId, ruleId);
    }
  }
  await deleteProductMetafields(admin, removedIds);
  return { synced: autoSync ? nextIds.length : 0 };
}
