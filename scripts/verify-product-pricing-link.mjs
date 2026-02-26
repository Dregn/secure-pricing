import fs from "node:fs";
import path from "node:path";
import { adminGraphql, getRequiredEnv } from "./lib/shopify-admin.mjs";

const PRODUCT_NAMESPACE = "$app:pricing";

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
  const productIdRaw = map.get("product-id") || "";
  const productId = productIdRaw.startsWith("gid://shopify/Product/")
    ? productIdRaw
    : `gid://shopify/Product/${productIdRaw}`;
  return { productId };
}

function ensureProductId(productId) {
  if (!productId || !productId.startsWith("gid://shopify/Product/")) {
    throw new Error("Pass --product-id as Product GID or numeric id.");
  }
}

function ensureTmpDir() {
  const dir = path.resolve("tmp");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function fetchProductPricing(productId) {
  const data = await adminGraphql(
    `#graphql
    query ProductPricing($id: ID!) {
      product(id: $id) {
        id
        title
        pricingRuleRef: metafield(namespace: "${PRODUCT_NAMESPACE}", key: "pricing_rule") {
          value
          type
        }
        pricingRuleJson: metafield(namespace: "${PRODUCT_NAMESPACE}", key: "pricing_rule_json") {
          value
          type
          jsonValue
        }
      }
    }`,
    { id: productId },
  );
  return data.product || null;
}

async function fetchMetaobject(metaobjectId) {
  const data = await adminGraphql(
    `#graphql
    query MetaobjectById($id: ID!) {
      metaobject(id: $id) {
        id
        type
        handle
        fields {
          key
          value
        }
      }
    }`,
    { id: metaobjectId },
  );
  return data.metaobject || null;
}

function parseJsonField(fields, key, fallback = null) {
  const field = (fields || []).find((f) => f.key === key);
  if (!field?.value) return fallback;
  try {
    return JSON.parse(field.value);
  } catch {
    return fallback;
  }
}

async function main() {
  const { shop } = getRequiredEnv();
  const { productId } = parseArgs();
  ensureProductId(productId);
  const numericProductId = productId.split("/").pop();

  const product = await fetchProductPricing(productId);
  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }

  const tmpDir = ensureTmpDir();
  const productOut = {
    product,
  };
  const productFile = path.join(tmpDir, `product-live-pricing-metafields-${numericProductId}.json`);
  fs.writeFileSync(productFile, JSON.stringify(productOut, null, 2), "utf8");

  const refId = product?.pricingRuleRef?.value || "";
  const hasRef = refId.startsWith("gid://shopify/Metaobject/");
  const hasJson = Boolean(product?.pricingRuleJson?.value);

  let metaobjectFile = "";
  if (hasRef) {
    const mo = await fetchMetaobject(refId);
    const fields = mo?.fields || [];
    const live = {
      metaobject: mo,
      derived: {
        source: (fields.find((f) => f.key === "source") || {}).value || "",
        slabs_json: parseJsonField(fields, "slabs_json", []),
        options_json: parseJsonField(fields, "options_json", {}),
      },
    };
    const numericMetaobjectId = refId.split("/").pop();
    metaobjectFile = path.join(tmpDir, `metaobject-live-${numericMetaobjectId}.json`);
    fs.writeFileSync(metaobjectFile, JSON.stringify(live, null, 2), "utf8");
  }

  console.log(`Shop: ${shop}`);
  console.log(`Product: ${product.id} (${product.title})`);
  console.log(`pricing_rule linked: ${hasRef ? "YES" : "NO"}`);
  console.log(`pricing_rule_json present: ${hasJson ? "YES" : "NO"}`);
  console.log(`Saved: ${productFile}`);
  if (metaobjectFile) console.log(`Saved: ${metaobjectFile}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

