const REQUIRED_ENV = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"];

export function getRequiredEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing env vars: ${missing.join(", ")}. Set them before running scripts.`,
    );
  }

  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  return { endpoint, token, shop, apiVersion };
}

export async function adminGraphql(query, variables = {}) {
  const { endpoint, token } = getRequiredEnv();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `Admin API request failed (${response.status}): ${JSON.stringify(json)}`,
    );
  }
  if (json.errors?.length) {
    throw new Error(`Admin API GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

export function unwrapUserErrors(result, path, label) {
  let cursor = result;
  for (const key of path) cursor = cursor?.[key];
  const userErrors = cursor?.userErrors || [];
  if (userErrors.length) {
    throw new Error(`${label} failed: ${JSON.stringify(userErrors)}`);
  }
}
