import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { adminGraphql, getRequiredEnv, unwrapUserErrors } from "./lib/shopify-admin.mjs";

const DEFAULT_SETTINGS_FILE = "store code/config/settings_data.json";
const DEFAULT_SECTION_KEY = "product-polyester-fabric";
const METAOBJECT_TYPE = "pricing_rule";
const PRODUCT_NAMESPACE = "$app:pricing";
const PRODUCT_KEY = "pricing_rule";

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

  const productIdsRaw = map.get("product-ids") || "";
  const productIds = productIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => (id.startsWith("gid://shopify/Product/") ? id : `gid://shopify/Product/${id}`));

  return {
    settingsFile: map.get("settings-file") || DEFAULT_SETTINGS_FILE,
    sectionKey: map.get("section-key") || DEFAULT_SECTION_KEY,
    source: map.get("source") || "polyester_fabric_section",
    ruleName: map.get("rule-name") || "Polyester Pricing Rule",
    handlePrefix: map.get("handle-prefix") || "polyester-pricing",
    productIds,
    createOnly: map.get("create-only") === "true",
    dryRun: map.get("dry-run") === "true",
    sharedHandle: map.get("shared-handle") || "",
    interactive: map.get("interactive") === "true",
  };
}

async function promptMissingArgs(args) {
  if (!args.interactive) return args;

  const rl = readline.createInterface({ input, output });
  const ask = async (label, current = "") => {
    const suffix = current ? ` [${current}]` : "";
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    return answer || current;
  };

  try {
    args.settingsFile = await ask("Settings file path", args.settingsFile);
    args.sectionKey = await ask("Section key", args.sectionKey);
    args.source = await ask("Rule source", args.source);
    args.ruleName = await ask("Rule name", args.ruleName);
    args.sharedHandle = await ask("Shared handle (no product ID)", args.sharedHandle || slugify(args.sectionKey));

    const productIdsRawDefault = args.productIds.join(",");
    const productIdsRaw = await ask("Product IDs (comma-separated, optional)", productIdsRawDefault);
    args.productIds = String(productIdsRaw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => (id.startsWith("gid://shopify/Product/") ? id : `gid://shopify/Product/${id}`));

    const createOnlyRaw = await ask("Create only (true/false)", args.createOnly ? "true" : "false");
    args.createOnly = createOnlyRaw === "true";

    const dryRunRaw = await ask("Dry run (true/false)", args.dryRun ? "true" : "false");
    args.dryRun = dryRunRaw === "true";
  } finally {
    rl.close();
  }

  return args;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePercent(value) {
  const match = String(value || "").match(/([-+]?\d+(?:\.\d+)?)\s*%/);
  if (!match) return Number.NaN;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function readJson(filePath) {
  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) throw new Error(`settings file not found: ${full}`);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function getSection(settingsData, sectionKey) {
  const direct = settingsData?.current?.sections?.[sectionKey];
  if (direct) return direct;
  throw new Error(`Section "${sectionKey}" not found in settings_data.json current.sections`);
}

function buildSlabs(section) {
  const blocks = section?.blocks || {};
  const orderedIds = Array.isArray(section?.block_order) ? section.block_order : Object.keys(blocks);

  const slabs = [];
  for (const blockId of orderedIds) {
    const block = blocks[blockId];
    if (!block || block.type !== "width_range") continue;
    const s = block.settings || {};
    slabs.push({
      min: toNumber(s.min_width, 0),
      max: toNumber(s.max_width, 0),
      amount: toNumber(s.amount, 0),
      // Carry slab-level shipping from theme settings.
      shipping: toNumber(s.shipping, 0),
      is_default_price: Boolean(s.is_default_price),
    });
  }
  return slabs.filter((s) => s.max >= s.min);
}

function buildOptionGroups(section) {
  const blocks = section?.blocks || {};
  const orderedIds = Array.isArray(section?.block_order) ? section.block_order : Object.keys(blocks);
  const sectionSettings = section?.settings || {};

  const options = {};

  for (let i = 1; i <= 6; i += 1) {
    const blockType = `options_${i}`;
    const groupLabel = String(sectionSettings[blockType] || blockType).trim();
    const groupKey = groupLabel || blockType;
    if (!groupKey) continue;

    const groupValues = {};
    for (const blockId of orderedIds) {
      const block = blocks[blockId];
      if (!block || block.type !== blockType) continue;
      const settings = block.settings || {};
      const optionName = String(settings.optionname || "").trim();
      if (!optionName) continue;
      groupValues[optionName] = toNumber(settings.amount, 0);
    }
    if (Object.keys(groupValues).length > 0) {
      options[groupKey] = groupValues;
    }
  }

  const shippingRules = {};
  for (const blockId of orderedIds) {
    const block = blocks[blockId];
    if (!block || block.type !== "options_7") continue;
    const settings = block.settings || {};
    const optionName = String(settings.optionname || "").trim();
    if (!optionName) continue;
    const amountRaw = String(settings.amount || "").trim();
    const key = optionName;

    const pct = parsePercent(amountRaw);
    if (Number.isFinite(pct)) {
      shippingRules[key] = {
        mode: "percent",
        percent: pct,
      };
    } else {
      shippingRules[key] = {
        mode: "fixed",
        amount: toNumber(amountRaw, 0),
      };
    }
  }
  if (Object.keys(shippingRules).length > 0) {
    options.shipping = shippingRules;
  }

  return options;
}

function buildRuleFromSection(section, source, ruleName) {
  const slabs = buildSlabs(section);
  if (slabs.length === 0) {
    throw new Error("No width_range blocks found in section. Cannot build slabs.");
  }

  const settings = section?.settings || {};
  const overflowMarkup = toNumber(settings.overflow_markup, 1.17) || 1.17;
  const maxPieceAreaSqFt = toNumber(settings.max_width, 900) || 900;

  return {
    rule_name: ruleName,
    source,
    max_piece_area_sqft: maxPieceAreaSqFt,
    overflow_markup: overflowMarkup,
    slab_metric: "total_area_sqft",
    slab_pricing_mode: "area_times_slab_rate_plus_shipping",
    overflow_mode: "last_slab_rate",
    shipping_surcharge: 0,
    active: true,
    slabs,
    options: buildOptionGroups(section),
  };
}

function toMetaobjectFields(rule) {
  return [
    { key: "rule_name", value: String(rule.rule_name) },
    { key: "source", value: String(rule.source) },
    { key: "max_piece_area_sqft", value: String(rule.max_piece_area_sqft) },
    { key: "overflow_markup", value: String(rule.overflow_markup) },
    { key: "slab_metric", value: String(rule.slab_metric) },
    { key: "slab_pricing_mode", value: String(rule.slab_pricing_mode) },
    { key: "overflow_mode", value: String(rule.overflow_mode) },
    { key: "slabs_json", value: JSON.stringify(rule.slabs) },
    { key: "options_json", value: JSON.stringify(rule.options || {}) },
    { key: "shipping_surcharge", value: String(rule.shipping_surcharge ?? 0) },
    { key: "active", value: String(rule.active ?? true) },
  ];
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

async function createRuleMetaobject(handle, fields) {
  const data = await adminGraphql(
    `#graphql
    mutation CreateRule($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id handle type }
        userErrors { field message }
      }
    }`,
    { metaobject: { type: METAOBJECT_TYPE, handle, fields } },
  );
  unwrapUserErrors(data, ["metaobjectCreate"], "metaobjectCreate");
  return data.metaobjectCreate.metaobject;
}

async function updateRuleMetaobject(id, fields) {
  const data = await adminGraphql(
    `#graphql
    mutation UpdateRule($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id handle type }
        userErrors { field message }
      }
    }`,
    { id, metaobject: { fields } },
  );
  unwrapUserErrors(data, ["metaobjectUpdate"], "metaobjectUpdate");
  return data.metaobjectUpdate.metaobject;
}

async function linkRuleToProduct(productId, metaobjectId, ruleJson) {
  const data = await adminGraphql(
    `#graphql
    mutation LinkRule($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace }
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
        {
          ownerId: productId,
          namespace: PRODUCT_NAMESPACE,
          key: "pricing_rule_json",
          type: "json",
          value: JSON.stringify(ruleJson),
        },
      ],
    },
  );
  unwrapUserErrors(data, ["metafieldsSet"], "metafieldsSet");
}

async function upsertAndLinkRuleForProduct(productId, handlePrefix, rule) {
  const productNumericId = productId.split("/").pop();
  const handle = slugify(`${handlePrefix}-${productNumericId}`);
  const ruleWithName = {
    ...rule,
    rule_name: `${rule.rule_name} ${productNumericId}`,
  };
  const fields = toMetaobjectFields(ruleWithName);
  const existing = await getMetaobjectByHandle(handle);
  const metaobject = existing
    ? await updateRuleMetaobject(existing.id, fields)
    : await createRuleMetaobject(handle, fields);

  await linkRuleToProduct(productId, metaobject.id, ruleWithName);
  return { handle, metaobjectId: metaobject.id, mode: existing ? "updated" : "created" };
}

async function upsertSharedRule(handle, rule) {
  const fields = toMetaobjectFields(rule);
  const existing = await getMetaobjectByHandle(handle);
  const metaobject = existing
    ? await updateRuleMetaobject(existing.id, fields)
    : await createRuleMetaobject(handle, fields);
  return { handle, metaobjectId: metaobject.id, mode: existing ? "updated" : "created" };
}

async function main() {
  const { shop } = getRequiredEnv();
  const args = await promptMissingArgs(parseArgs());

  if (!args.createOnly && args.productIds.length === 0) {
    throw new Error("Pass --product-ids (comma-separated), or use --create-only true.");
  }

  const settingsData = readJson(args.settingsFile);
  const section = getSection(settingsData, args.sectionKey);
  const rule = buildRuleFromSection(section, args.source, args.ruleName);

  console.log(`Target shop: ${shop}`);
  console.log(`Settings file: ${path.resolve(args.settingsFile)}`);
  console.log(`Section: ${args.sectionKey}`);
  console.log(`Products: ${args.productIds.length}`);
  console.log(`Source: ${rule.source}`);

  if (args.dryRun) {
    console.log(JSON.stringify(rule, null, 2));
    return;
  }

  const sharedHandle = slugify(args.sharedHandle || "");
  if (sharedHandle) {
    const shared = await upsertSharedRule(sharedHandle, {
      ...rule,
      rule_name: args.ruleName || args.sectionKey,
    });

    if (args.createOnly) {
      console.log(`${shared.mode.toUpperCase()} ${shared.handle} -> ${shared.metaobjectId} (not linked)`);
      return;
    }

    for (const productId of args.productIds) {
      await linkRuleToProduct(productId, shared.metaobjectId, {
        ...rule,
        rule_name: args.ruleName || args.sectionKey,
      });
      console.log(`LINKED ${shared.handle} -> ${productId}`);
    }
    return;
  }

  if (args.createOnly) {
    const result = await upsertSharedRule(slugify(args.handlePrefix || args.sectionKey), {
      ...rule,
      rule_name: args.ruleName || args.sectionKey,
    });
    console.log(`${result.mode.toUpperCase()} ${result.handle} -> ${result.metaobjectId} (not linked)`);
    return;
  }

  for (const productId of args.productIds) {
    const result = await upsertAndLinkRuleForProduct(productId, args.handlePrefix, rule);
    console.log(
      `${result.mode.toUpperCase()} ${result.handle} -> ${result.metaobjectId} (linked to ${productId})`,
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
