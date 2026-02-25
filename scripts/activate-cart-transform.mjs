import { PrismaClient } from "@prisma/client";

const shopInput = process.argv[2] || process.env.SHOP;
if (!shopInput) {
  console.error("Usage: npm run activate:transform -- <shop-domain>");
  console.error("Example: npm run activate:transform -- backdropsourcenz.myshopify.com");
  process.exit(1);
}

const shop = shopInput.endsWith(".myshopify.com")
  ? shopInput
  : `${shopInput}.myshopify.com`;

const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-10";

async function adminGraphql(accessToken, query, variables = {}) {
  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(
      `GraphQL request failed: ${response.status} ${response.statusText}\n${JSON.stringify(payload, null, 2)}`,
    );
  }
  return payload.data;
}

function isCartTransformApiType(value) {
  if (!value) return false;
  const normalized = String(value).toLowerCase();
  return normalized === "cart_transform" || normalized === "carttransform";
}

async function run() {
  let prisma;
  let accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
  try {
    if (!accessToken) {
      try {
        prisma = new PrismaClient();
      } catch (error) {
        throw new Error(
          `Prisma client is not generated. Run "npx prisma generate" first.\n${error.message || error}`,
        );
      }

      let session;
      try {
        session =
          (await prisma.session.findFirst({
            where: { shop, isOnline: false },
          })) ||
          (await prisma.session.findFirst({
            where: { shop },
          }));
      } catch (error) {
        throw new Error(
          `Session table is unavailable in local SQLite.
Run with env SHOPIFY_ADMIN_ACCESS_TOKEN, or fix local Prisma migrations first.
Original error: ${error.message || error}`,
        );
      }

      if (!session?.accessToken) {
        throw new Error(
          `No session token found for ${shop} in prisma Session table.
Either reinstall app on this store OR run with env SHOPIFY_ADMIN_ACCESS_TOKEN.`,
        );
      }
      accessToken = session.accessToken;
    }

    const fnData = await adminGraphql(
      accessToken,
      `#graphql
      query ListFunctions {
        shopifyFunctions(first: 50) {
          nodes {
            id
            title
            apiType
          }
        }
      }`,
    );

    const functions = fnData.shopifyFunctions?.nodes || [];
    const cartTransformFunction = functions.find((fn) => isCartTransformApiType(fn.apiType));

    if (!cartTransformFunction) {
      throw new Error(
        `No cart_transform function found on ${shop}. Make sure app deploy completed and app is installed on this store.`,
      );
    }

    console.log("Found cart transform function:");
    console.log(
      JSON.stringify(
        {
          id: cartTransformFunction.id,
          title: cartTransformFunction.title,
          apiType: cartTransformFunction.apiType,
        },
        null,
        2,
      ),
    );

    const existingData = await adminGraphql(
      accessToken,
      `#graphql
      query ListCartTransforms {
        cartTransforms(first: 20) {
          nodes {
            id
            functionId
            blockOnFailure
          }
        }
      }`,
    );

    const existing = existingData.cartTransforms?.nodes || [];
    const alreadyBound = existing.find((x) => x.functionId === cartTransformFunction.id);

    if (alreadyBound) {
      console.log("Cart transform already active:");
      console.log(JSON.stringify(alreadyBound, null, 2));
      return;
    }

    const createData = await adminGraphql(
      accessToken,
      `#graphql
      mutation CreateCartTransform($functionId: String!) {
        cartTransformCreate(functionId: $functionId, blockOnFailure: true) {
          cartTransform {
            id
            functionId
            blockOnFailure
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { functionId: cartTransformFunction.id },
    );

    const result = createData.cartTransformCreate;
    if (result.userErrors?.length) {
      throw new Error(`cartTransformCreate returned errors:\n${JSON.stringify(result.userErrors, null, 2)}`);
    }

    console.log("Created cart transform:");
    console.log(JSON.stringify(result.cartTransform, null, 2));
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
