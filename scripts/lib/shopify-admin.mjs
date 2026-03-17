import { SHOPIFY_SCRIPT_CONFIG } from "../shopify-admin.config.mjs";

let cachedRuntimeToken = "";

function normalizeStore(input) {
  if (!input) return "";
  const normalized = String(input).trim();
  return normalized
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/\/.*$/, "")
    .trim();
}

function getRequiredConfig() {
  const configuredShop = process.env.SHOPIFY_STORE_DOMAIN || SHOPIFY_SCRIPT_CONFIG.storeDomain;
  const shop = normalizeStore(configuredShop);
  const apiVersion = SHOPIFY_SCRIPT_CONFIG.apiVersion || "2026-01";
  const adminAccessToken = SHOPIFY_SCRIPT_CONFIG.adminAccessToken || "";
  const clientId = SHOPIFY_SCRIPT_CONFIG.clientId || "";
  const clientSecret = SHOPIFY_SCRIPT_CONFIG.clientSecret || "";

  if (!shop) {
    throw new Error(
      "Set scripts/shopify-admin.config.mjs -> storeDomain, or set SHOPIFY_STORE_DOMAIN env var (example: https://www.backdropsource.de or backdropsource.de).",
    );
  }

  const hasAdminToken =
    adminAccessToken &&
    adminAccessToken !== "REPLACE_WITH_STORE_ADMIN_API_TOKEN" &&
    adminAccessToken.startsWith("shpat_");

  const hasClientCredentials =
    clientId &&
    clientSecret &&
    !clientId.startsWith("REPLACE_") &&
    !clientSecret.startsWith("REPLACE_");

  if (!hasAdminToken && !hasClientCredentials) {
    throw new Error(
      "Set either adminAccessToken (shpat_...) OR clientId/clientSecret in scripts/shopify-admin.config.mjs.",
    );
  }

  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  return {
    endpoint,
    shop,
    apiVersion,
    adminAccessToken,
    clientId,
    clientSecret,
    hasAdminToken,
  };
}

export function getRequiredEnv() {
  const config = getRequiredConfig();
  return {
    endpoint: config.endpoint,
    shop: config.shop,
    apiVersion: config.apiVersion,
  };
}

async function fetchAdminTokenFromClientCredentials(shop, clientId, clientSecret) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  const json = await response.json();
  if (!response.ok || !json?.access_token) {
    throw new Error(
      `Client credentials token exchange failed (${response.status}): ${JSON.stringify(json)}`,
    );
  }
  return json.access_token;
}

async function getRuntimeToken(config) {
  if (cachedRuntimeToken) return cachedRuntimeToken;

  if (config.hasAdminToken) {
    cachedRuntimeToken = config.adminAccessToken;
    return cachedRuntimeToken;
  }

  cachedRuntimeToken = await fetchAdminTokenFromClientCredentials(
    config.shop,
    config.clientId,
    config.clientSecret,
  );
  return cachedRuntimeToken;
}

export async function adminGraphql(query, variables = {}) {
  const config = getRequiredConfig();
  const token = await getRuntimeToken(config);
  const { endpoint } = config;

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
