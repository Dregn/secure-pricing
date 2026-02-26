import fs from "node:fs";
import path from "node:path";
import { adminGraphql, getRequiredEnv, unwrapUserErrors } from "./lib/shopify-admin.mjs";

const METAOBJECT_TYPE = "pricing_rule";
const PRODUCT_NAMESPACE = "$app:pricing";
const PRODUCT_KEY = "pricing_rule";
const DEFAULT_FILE = "scripts/templates/pricing-rules-template.csv";

function parseArgs() {
  const args = process.argv.slice(2);
  const map = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    map.set(key, value);
  }
  return {
    file: map.get("file") || DEFAULT_FILE,
  };
}

function parseCsvLine(line) {
  const out = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(value);
      value = "";
      continue;
    }
    value += char;
  }
  out.push(value);
  return out.map((v) => v.trim());
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? "";
    });
    row.__line = i + 1;
    rows.push(row);
  }
  return rows;
}

function productGid(raw) {
  const val = String(raw || "").trim();
  if (!val) return "";
  if (val.startsWith("gid://shopify/Product/")) return val;
  if (/^\d+$/.test(val)) return `gid://shopify/Product/${val}`;
  return "";
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseJsonField(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function getMetaobjectDefinitionByType(type) {
  const data = await adminGraphql(
    `#graphql
    query MetaobjectDefinitions {
      metaobjectDefinitions(first: 200) {
        nodes {
          id
          type
          name
        }
      }
    }`,
  );
  return data.metaobjectDefinitions.nodes.find((node) => node.type === type) || null;
}

async function createMetaobjectDefinitionIfMissing() {
  const existing = await getMetaobjectDefinitionByType(METAOBJECT_TYPE);
  if (existing) {
    console.log(`Metaobject definition exists: ${existing.id} (${existing.type})`);
    return existing;
  }

  const data = await adminGraphql(
    `#graphql
    mutation CreatePricingRuleDefinition($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition {
          id
          type
          name
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      definition: {
        name: "Pricing Rule",
        type: METAOBJECT_TYPE,
        fieldDefinitions: [
          { name: "Rule Name", key: "rule_name", type: "single_line_text_field", required: true },
          { name: "Source", key: "source", type: "single_line_text_field", required: true },
          { name: "Max Piece Area SqFt", key: "max_piece_area_sqft", type: "number_decimal", required: true },
          { name: "Overflow Markup", key: "overflow_markup", type: "number_decimal", required: true },
          { name: "Slab Metric", key: "slab_metric", type: "single_line_text_field", required: false },
          { name: "Slab Pricing Mode", key: "slab_pricing_mode", type: "single_line_text_field", required: false },
          { name: "Overflow Mode", key: "overflow_mode", type: "single_line_text_field", required: false },
          { name: "Overflow Unit Rate", key: "overflow_unit_rate", type: "number_decimal", required: false },
          { name: "Slabs JSON", key: "slabs_json", type: "json", required: true },
          { name: "Options JSON", key: "options_json", type: "json", required: false },
          { name: "Shipping Surcharge", key: "shipping_surcharge", type: "number_decimal", required: false },
          { name: "Active", key: "active", type: "boolean", required: false },
        ],
      },
    },
  );

  unwrapUserErrors(data, ["metaobjectDefinitionCreate"], "metaobjectDefinitionCreate");
  const created = data.metaobjectDefinitionCreate.metaobjectDefinition;
  console.log(`Created metaobject definition: ${created.id} (${created.type})`);
  return created;
}

async function getProductMetafieldDefinition() {
  const data = await adminGraphql(
    `#graphql
    query ProductMetafieldDefs {
      metafieldDefinitions(first: 200, ownerType: PRODUCT) {
        nodes {
          id
          namespace
          key
        }
      }
    }`,
  );
  return (
    data.metafieldDefinitions.nodes.find((node) => {
      if (node.key !== PRODUCT_KEY) return false;
      if (node.namespace === PRODUCT_NAMESPACE) return true;
      return node.namespace?.endsWith("--pricing");
    }) || null
  );
}

async function createProductMetafieldDefinitionIfMissing(metaobjectDefinitionId) {
  const existing = await getProductMetafieldDefinition();
  if (existing) {
    console.log(`Product metafield definition exists: ${existing.id} (${PRODUCT_NAMESPACE}.${PRODUCT_KEY})`);
    return existing;
  }

  const data = await adminGraphql(
    `#graphql
    mutation CreateProductMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
          namespace
          key
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      definition: {
        name: "Pricing Rule",
        namespace: PRODUCT_NAMESPACE,
        key: PRODUCT_KEY,
        ownerType: "PRODUCT",
        type: "metaobject_reference",
        validations: [{ name: "metaobject_definition_id", value: metaobjectDefinitionId }],
      },
    },
  );

  unwrapUserErrors(data, ["metafieldDefinitionCreate"], "metafieldDefinitionCreate");
  return data.metafieldDefinitionCreate.createdDefinition;
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
    { handle: { type: METAOBJECT_TYPE, handle } },
  );
  return data.metaobjectByHandle || null;
}

function toMetaobjectFields(rule) {
  const fields = [
    { key: "rule_name", value: String(rule.rule_name) },
    { key: "source", value: String(rule.source) },
    { key: "max_piece_area_sqft", value: String(rule.max_piece_area_sqft) },
    { key: "overflow_markup", value: String(rule.overflow_markup) },
    { key: "slab_metric", value: String(rule.slab_metric) },
    { key: "slab_pricing_mode", value: String(rule.slab_pricing_mode) },
    { key: "overflow_mode", value: String(rule.overflow_mode) },
    { key: "slabs_json", value: JSON.stringify(rule.slabs_json) },
    { key: "options_json", value: JSON.stringify(rule.options_json) },
    { key: "shipping_surcharge", value: String(rule.shipping_surcharge) },
    { key: "active", value: String(rule.active) },
  ];
  if (Number.isFinite(rule.overflow_unit_rate)) {
    fields.push({ key: "overflow_unit_rate", value: String(rule.overflow_unit_rate) });
  }
  return fields;
}

async function createOrUpdateRule(rule) {
  const fields = toMetaobjectFields(rule);
  const existing = await getMetaobjectByHandle(rule.handle);

  if (existing) {
    const data = await adminGraphql(
      `#graphql
      mutation UpdateRule($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message }
        }
      }`,
      { id: existing.id, metaobject: { fields } },
    );
    unwrapUserErrors(data, ["metaobjectUpdate"], `metaobjectUpdate (${rule.handle})`);
    return data.metaobjectUpdate.metaobject;
  }

  const data = await adminGraphql(
    `#graphql
    mutation CreateRule($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message }
      }
    }`,
    { metaobject: { type: METAOBJECT_TYPE, handle: rule.handle, fields } },
  );
  unwrapUserErrors(data, ["metaobjectCreate"], `metaobjectCreate (${rule.handle})`);
  return data.metaobjectCreate.metaobject;
}

async function linkRuleToProduct(productId, metaobjectId) {
  const data = await adminGraphql(
    `#graphql
    mutation LinkRule($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: productId,
          namespace: PRODUCT_NAMESPACE,
          key: PRODUCT_KEY,
          type: "metaobject_reference",
          value: metaobjectId,
        },
      ],
    },
  );
  unwrapUserErrors(data, ["metafieldsSet"], `metafieldsSet (${productId})`);
}

function normalizeRow(row) {
  const productId = productGid(row.product_id);
  if (!productId) {
    throw new Error(`Line ${row.__line}: invalid product_id`);
  }

  const ruleName = String(row.rule_name || "").trim();
  const source = String(row.source || "").trim();
  if (!ruleName || !source) {
    throw new Error(`Line ${row.__line}: rule_name and source are required`);
  }

  const slabs = parseJsonField(row.slabs_json, []);
  if (!Array.isArray(slabs) || slabs.length === 0) {
    throw new Error(`Line ${row.__line}: slabs_json must be a non-empty JSON array`);
  }

  const options = parseJsonField(row.options_json, {});
  const handle = String(row.handle || "").trim() || slugify(`${ruleName}-${productId.split("/").pop()}`);
  const activeStr = String(row.active || "true").trim().toLowerCase();

  return {
    line: row.__line,
    productId,
    handle,
    rule_name: ruleName,
    source,
    max_piece_area_sqft: toNumber(row.max_piece_area_sqft, 900),
    overflow_markup: toNumber(row.overflow_markup, 1.17),
    slab_metric: String(row.slab_metric || "total_area_sqft").trim(),
    slab_pricing_mode: String(row.slab_pricing_mode || "rate").trim(),
    overflow_mode: String(row.overflow_mode || "last_slab_rate").trim(),
    overflow_unit_rate: toNumber(row.overflow_unit_rate, Number.NaN),
    slabs_json: slabs,
    options_json: options && typeof options === "object" ? options : {},
    shipping_surcharge: toNumber(row.shipping_surcharge, 0),
    active: activeStr !== "false",
  };
}

async function main() {
  const { shop, apiVersion } = getRequiredEnv();
  const { file } = parseArgs();
  const fullPath = path.resolve(file);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Input sheet not found: ${fullPath}`);
  }

  console.log(`Target shop: ${shop}`);
  console.log(`Admin API version: ${apiVersion}`);
  console.log(`Input file: ${fullPath}`);

  const raw = fs.readFileSync(fullPath, "utf8");
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    throw new Error("Input sheet has no data rows.");
  }

  const metaobjectDefinition = await createMetaobjectDefinitionIfMissing();
  await createProductMetafieldDefinitionIfMissing(metaobjectDefinition.id);

  let success = 0;
  for (const row of rows) {
    const normalized = normalizeRow(row);
    const rule = await createOrUpdateRule(normalized);
    await linkRuleToProduct(normalized.productId, rule.id);
    success += 1;
    console.log(
      `Line ${normalized.line}: linked ${normalized.productId} -> ${rule.id} (${normalized.handle})`,
    );
  }

  console.log(`Done. Processed ${success}/${rows.length} row(s).`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
