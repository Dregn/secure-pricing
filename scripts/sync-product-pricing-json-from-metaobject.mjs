import { adminGraphql, getRequiredEnv, unwrapUserErrors } from "./lib/shopify-admin.mjs";

const NS = "app--327440302081--pricing";

function parseArgs() {
  const args = process.argv.slice(2);
  const map = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    map.set(key, val);
  }
  return {
    productId: map.get("product-id") || "",
  };
}

function ensureProductId(gid) {
  if (!gid || !gid.startsWith("gid://shopify/Product/")) {
    throw new Error("Pass --product-id as a valid Product GID (gid://shopify/Product/...).");
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = true) {
  const t = String(value ?? "").trim().toLowerCase();
  if (t === "true") return true;
  if (t === "false") return false;
  return fallback;
}

function parseJsonField(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function fieldsToRule(fields) {
  const map = new Map(fields.map((f) => [f.key, f.value]));
  const rule = {
    rule_name: String(map.get("rule_name") || ""),
    source: String(map.get("source") || ""),
    max_piece_area_sqft: toNumber(map.get("max_piece_area_sqft"), 900),
    overflow_markup: toNumber(map.get("overflow_markup"), 1.17),
    slab_metric: String(map.get("slab_metric") || "total_area_sqft"),
    slab_pricing_mode: String(map.get("slab_pricing_mode") || "area_times_slab_rate_plus_shipping"),
    overflow_mode: String(map.get("overflow_mode") || "last_slab_rate"),
    shipping_surcharge: toNumber(map.get("shipping_surcharge"), 0),
    active: toBool(map.get("active"), true),
    slabs: parseJsonField(map.get("slabs_json"), []),
    options: parseJsonField(map.get("options_json"), {}),
  };

  const overflowUnitRateRaw = map.get("overflow_unit_rate");
  if (overflowUnitRateRaw != null && String(overflowUnitRateRaw).trim() !== "") {
    rule.overflow_unit_rate = toNumber(overflowUnitRateRaw, NaN);
  }

  if (!rule.source || !Array.isArray(rule.slabs) || rule.slabs.length === 0) {
    throw new Error("Invalid pricing rule fields on metaobject. Missing source/slabs_json.");
  }
  return rule;
}

async function getLinkedMetaobjectId(productId) {
  const data = await adminGraphql(
    `#graphql
    query ProductRuleRef($id: ID!, $ns: String!) {
      product(id: $id) {
        id
        title
        ruleRef: metafield(namespace: $ns, key: "pricing_rule") {
          value
          type
        }
      }
    }`,
    { id: productId, ns: NS },
  );

  const ref = data?.product?.ruleRef?.value || "";
  if (!ref.startsWith("gid://shopify/Metaobject/")) {
    throw new Error(`Product ${productId} has no valid pricing_rule metaobject reference.`);
  }
  return ref;
}

async function getMetaobjectFields(metaobjectId) {
  const data = await adminGraphql(
    `#graphql
    query RuleMetaobject($id: ID!) {
      metaobject(id: $id) {
        id
        handle
        type
        fields {
          key
          value
        }
      }
    }`,
    { id: metaobjectId },
  );
  const metaobject = data?.metaobject;
  if (!metaobject) throw new Error(`Metaobject not found: ${metaobjectId}`);
  return metaobject;
}

async function setProductPricingRuleJson(productId, rule) {
  const data = await adminGraphql(
    `#graphql
    mutation SetRuleJson($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace }
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: productId,
          namespace: NS,
          key: "pricing_rule_json",
          type: "json",
          value: JSON.stringify(rule),
        },
      ],
    },
  );
  unwrapUserErrors(data, ["metafieldsSet"], "metafieldsSet");
}

async function main() {
  const { shop } = getRequiredEnv();
  const { productId } = parseArgs();
  ensureProductId(productId);

  console.log(`Target shop: ${shop}`);
  console.log(`Product: ${productId}`);

  const metaobjectId = await getLinkedMetaobjectId(productId);
  const metaobject = await getMetaobjectFields(metaobjectId);
  const rule = fieldsToRule(metaobject.fields || []);
  await setProductPricingRuleJson(productId, rule);

  console.log(`Synced pricing_rule_json from ${metaobject.id} (${metaobject.handle})`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

