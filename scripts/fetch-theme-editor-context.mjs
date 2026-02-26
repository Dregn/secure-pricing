import { adminGraphql } from "./lib/shopify-admin.mjs";

const THEME_NUMERIC_ID = process.argv[2] || "150816260288";
const PRODUCT_HANDLE = process.argv[3] || "wrinkle-free-polyester-fabric-banner-printing";

const themeId = `gid://shopify/OnlineStoreTheme/${THEME_NUMERIC_ID}`;
const filenames = [
  "sections/product-polyester-fabric.liquid",
  `templates/product.${PRODUCT_HANDLE}.json`,
  "templates/product.json",
  "config/settings_data.json",
];

const query = `#graphql
  query ThemeFiles($themeId: ID!, $filenames: [String!]!) {
    theme(id: $themeId) {
      id
      name
      role
      files(filenames: $filenames) {
        nodes {
          filename
          body {
            __typename
            ... on OnlineStoreThemeFileBodyText {
              content
            }
            ... on OnlineStoreThemeFileBodyBase64 {
              contentBase64
            }
            ... on OnlineStoreThemeFileBodyUrl {
              url
            }
          }
        }
      }
    }
  }
`;

function logFile(file) {
  const filename = file?.filename || "unknown";
  const body = file?.body;
  const type = body?.__typename || "unknown";

  console.log(`\n===== ${filename} (${type}) =====`);

  if (type === "OnlineStoreThemeFileBodyText") {
    const text = String(body.content || "");
    console.log(text.slice(0, 20000));
    if (text.length > 20000) {
      console.log(`\n...truncated, total chars: ${text.length}`);
    }
    return;
  }

  if (type === "OnlineStoreThemeFileBodyBase64") {
    const b64 = String(body.contentBase64 || "");
    console.log(`base64 length: ${b64.length}`);
    return;
  }

  if (type === "OnlineStoreThemeFileBodyUrl") {
    console.log(body.url || "");
    return;
  }

  console.log(JSON.stringify(file, null, 2));
}

async function main() {
  const data = await adminGraphql(query, { themeId, filenames });
  const theme = data?.theme;
  if (!theme) {
    throw new Error("Theme not found.");
  }

  console.log(`Theme: ${theme.name} (${theme.role}) [${theme.id}]`);

  const files = theme.files?.nodes || [];
  if (files.length === 0) {
    console.log("No files returned.");
    return;
  }

  for (const file of files) {
    logFile(file);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
