import { adminGraphql, getRequiredEnv, unwrapUserErrors } from "./lib/shopify-admin.mjs";

const METAOBJECT_TYPE = "pricing_rule";
const PRODUCT_NAMESPACE = "$app:pricing";
const PRODUCT_KEY = "pricing_rule";

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
          name
          type {
            name
          }
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
    console.log(
      `Product metafield definition exists: ${existing.id} (${existing.namespace}.${existing.key})`,
    );
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
        namespace: PRODUCT_NAMESPACE,
        key: PRODUCT_KEY,
        ownerType: "PRODUCT",
        type: "metaobject_reference",
        validations: [
          {
            name: "metaobject_definition_id",
            value: metaobjectDefinitionId,
          },
        ],
      },
    },
  );

  unwrapUserErrors(data, ["metafieldDefinitionCreate"], "metafieldDefinitionCreate");
  const created = data.metafieldDefinitionCreate.createdDefinition;
  console.log(
    `Created product metafield definition: ${created.id} (${created.namespace}.${created.key})`,
  );
  return created;
}

async function main() {
  const { shop, apiVersion } = getRequiredEnv();
  console.log(`Target shop: ${shop}`);
  console.log(`Admin API version: ${apiVersion}`);

  const metaobjectDefinition = await createMetaobjectDefinitionIfMissing();
  await createProductMetafieldDefinitionIfMissing(metaobjectDefinition.id);

  console.log("Pricing schema setup complete.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
