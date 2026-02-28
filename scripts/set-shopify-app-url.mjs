import fs from "node:fs";
import path from "node:path";

const inputUrl = process.argv[2];

if (!inputUrl) {
  console.error("Usage: npm run config:set-app-url -- <https-url>");
  console.error(
    "Example: npm run config:set-app-url -- https://secure-pricing-app.your-subdomain.workers.dev",
  );
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(inputUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only https URLs are allowed.");
  }
} catch (error) {
  console.error(`Invalid URL: ${inputUrl}`);
  console.error(error.message || error);
  process.exit(1);
}

const normalizedBase = parsedUrl.origin;
const redirectUrls = [
  `${normalizedBase}/auth/callback`,
  `${normalizedBase}/auth/shopify/callback`,
  `${normalizedBase}/api/auth/callback`,
];

const repoRoot = process.cwd();
const targetTomls = [
  "shopify.app.toml",
  "shopify.app.cart-transform-usa.toml",
].map((file) => path.join(repoRoot, file));

function updateTomlFile(filePath) {
  if (!fs.existsSync(filePath)) return false;

  let content = fs.readFileSync(filePath, "utf8");
  const nextAppUrlLine = `application_url = "${normalizedBase}"`;
  const nextRedirectLine = `redirect_urls = [ ${redirectUrls.map((url) => `"${url}"`).join(", ")} ]`;

  if (/^application_url\s*=.*$/m.test(content)) {
    content = content.replace(/^application_url\s*=.*$/m, nextAppUrlLine);
  } else {
    content = `${nextAppUrlLine}\n${content}`;
  }

  if (/^redirect_urls\s*=.*$/m.test(content)) {
    content = content.replace(/^redirect_urls\s*=.*$/m, nextRedirectLine);
  } else if (/^\[auth\]\s*$/m.test(content)) {
    content = content.replace(/^\[auth\]\s*$/m, `[auth]\n${nextRedirectLine}`);
  } else {
    content += `\n[auth]\n${nextRedirectLine}\n`;
  }

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

const updated = [];
for (const target of targetTomls) {
  if (updateTomlFile(target)) {
    updated.push(target);
  }
}

const envPath = path.join(repoRoot, ".env");
if (fs.existsSync(envPath)) {
  let envContent = fs.readFileSync(envPath, "utf8");
  if (/^SHOPIFY_APP_URL=.*$/m.test(envContent)) {
    envContent = envContent.replace(/^SHOPIFY_APP_URL=.*$/m, `SHOPIFY_APP_URL=${normalizedBase}`);
  } else {
    envContent += `\nSHOPIFY_APP_URL=${normalizedBase}\n`;
  }
  fs.writeFileSync(envPath, envContent, "utf8");
}

if (!updated.length) {
  console.error("No Shopify app TOML config files found in current directory.");
  process.exit(1);
}

console.log("Updated Shopify app configuration:");
for (const filePath of updated) {
  console.log(`- ${path.basename(filePath)}`);
}
console.log(`application_url: ${normalizedBase}`);
console.log("redirect_urls:");
for (const url of redirectUrls) {
  console.log(`- ${url}`);
}
