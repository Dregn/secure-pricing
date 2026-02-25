import fs from "node:fs";
import path from "node:path";
import { adminGraphql, getRequiredEnv, unwrapUserErrors } from "./lib/shopify-admin.mjs";

const DEFAULT_RULE_FILE = "scripts/examples/pricing-rule.sample.json";
const METAOBJECT_TYPE = "pricing_rule";

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
    handle: map.get("handle") || "",
    ruleFile: map.get("rule-file") || DEFAULT_RULE_FILE,
  };
}

function ensureProductId(gid) {
  if (!gid || !gid.startsWith("gid://shopify/Product/")) {
    throw new Error("Pass --product-id as a valid Product GID (gid://shopify/Product/...).");
  }
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function readRuleFile(ruleFilePath) {
  const fullPath = path.resolve(ruleFilePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Rule file not found: ${fullPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  if (!parsed?.rule_name || !parsed?.source || !Array.isArray(parsed?.slabs)) {
    throw new Error("Rule JSON must include: rule_name, source, slabs[]");
  }
  return parsed;
}

function toMetaobjectFields(rule) {
  const fields = [
    { key: "rule_name", value: String(rule.rule_name) },
    { key: "source", value: String(rule.source) },
    { key: "max_piece_area_sqft", value: String(rule.max_piece_area_sqft ?? 900) },
    { key: "overflow_markup", value: String(rule.overflow_markup ?? 1.17) },
    { key: "slab_metric", value: String(rule.slab_metric ?? "total_area_sqft") },
    { key: "slab_pricing_mode", value: String(rule.slab_pricing_mode ?? "rate") },
    { key: "overflow_mode", value: String(rule.overflow_mode ?? "last_slab_rate") },
    { key: "slabs_json", value: JSON.stringify(rule.slabs) },
    { key: "options_json", value: JSON.stringify(rule.options ?? {}) },
    { key: "shipping_surcharge", value: String(rule.shipping_surcharge ?? 0) },
    { key: "active", value: String(rule.active ?? true) },
  ];
  if (Number.isFinite(Number(rule.overflow_unit_rate))) {
    fields.push({ key: "overflow_unit_rate", value: String(rule.overflow_unit_rate) });
  }
  return fields;
}

async function getMetaobjectByHandle(handle) {
  const data = await adminGraphql(
    `#graphql
    query RuleByHandle($handle: MetaobjectHandleInput!) {
      metaobjectByHandle(handle: $handle) {
        id
        handle
      }
    }`,
    {
      handle: {
        type: METAOBJECT_TYPE,
        handle,
      },
    },
  );
  return data.metaobjectByHandle || null;
}

async function createRuleMetaobject(handle, fields) {
  const data = await adminGraphql(
    `#graphql
    mutation CreateRule($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      metaobject: {
        type: METAOBJECT_TYPE,
        handle,
        fields,
      },
    },
  );
  unwrapUserErrors(data, ["metaobjectCreate"], "metaobjectCreate");
  return data.metaobjectCreate.metaobject;
}

async function updateRuleMetaobject(id, fields) {
  const data = await adminGraphql(
    `#graphql
    mutation UpdateRule($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      id,
      metaobject: { fields },
    },
  );
  unwrapUserErrors(data, ["metaobjectUpdate"], "metaobjectUpdate");
  return data.metaobjectUpdate.metaobject;
}

async function linkRuleToProduct(productId, metaobjectId) {
  const data = await adminGraphql(
    `#graphql
    mutation LinkRule($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          key
          namespace
          owner {
            ... on Product {
              id
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      metafields: [
        {
          ownerId: productId,
          namespace: "custom",
          key: "pricing_rule",
          type: "metaobject_reference",
          value: metaobjectId,
        },
      ],
    },
  );
  unwrapUserErrors(data, ["metafieldsSet"], "metafieldsSet");
  return data.metafieldsSet.metafields[0];
}

async function main() {
  const { shop } = getRequiredEnv();
  const { productId, handle, ruleFile } = parseArgs();
  ensureProductId(productId);

  const rule = readRuleFile(ruleFile);
  const resolvedHandle = handle || slugify(`${rule.rule_name}-${productId.split("/").pop()}`);
  const fields = toMetaobjectFields(rule);

  console.log(`Target shop: ${shop}`);
  console.log(`Rule file: ${path.resolve(ruleFile)}`);
  console.log(`Rule handle: ${resolvedHandle}`);

  const existing = await getMetaobjectByHandle(resolvedHandle);
  const metaobject = existing
    ? await updateRuleMetaobject(existing.id, fields)
    : await createRuleMetaobject(resolvedHandle, fields);

  await linkRuleToProduct(productId, metaobject.id);

  console.log(`Rule ${existing ? "updated" : "created"}: ${metaobject.id}`);
  console.log(`Linked to product: ${productId}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
