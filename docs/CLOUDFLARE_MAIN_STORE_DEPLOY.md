# Cloudflare Main Store Deploy (Pricing Rules Form)

This is the shortest path to open your Pricing Rules form on the main store without running `shopify app dev`.

## Goal
- Host app backend on a Node-compatible runtime.
- Put Cloudflare Worker in front as public URL.
- Point Shopify app config to that hosted URL.
- Deploy app config + function.
- Open app in main store (`bdsus`) and use forms.

## Architecture (required)

This repo is a Shopify React Router Node app (`@shopify/.../adapters/node` + Prisma session storage). It does not run directly as a Cloudflare Worker module runtime without a deeper refactor.

Current production-safe setup:
- Node backend host (Render/Railway/Fly/etc.): runs the app and DB-backed sessions
- Cloudflare Worker proxy: stable edge URL that forwards all requests to Node backend

The Worker proxy config now lives in:
- `wrangler.jsonc`
- worker entry: `cloudflare/worker-proxy.mjs`
- env var: `BACKEND_ORIGIN` (your Node backend public origin)

## 1) Deploy Node backend first

Deploy this app to a Node-compatible host and make sure it is reachable via HTTPS.

Required backend env vars include:
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES`
- `SHOPIFY_APP_URL` (set this to final Cloudflare Worker URL after step 2)
- DB/session vars (`DATABASE_URL`, etc.)

## 2) Set Worker proxy backend origin and deploy Cloudflare Worker

In Cloudflare UI (or Wrangler env vars), set:
- `BACKEND_ORIGIN=https://<your-node-backend-domain>`

Then deploy:

```powershell
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
npm run deploy:cloudflare
```

Get Worker URL, for example:
- `https://secure-pricing-app.<subdomain>.workers.dev`

## 3) Update Shopify app URLs locally

Run:

```powershell
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
npm run config:set-app-url -- https://secure-pricing-app.<subdomain>.workers.dev
```

This updates:
- `shopify.app.cart-transform-usa.toml`
- `shopify.app.toml`
- `.env` (`SHOPIFY_APP_URL`)

Also set the same Worker URL in your Node backend environment:
- `SHOPIFY_APP_URL=https://secure-pricing-app.<subdomain>.workers.dev`

## 4) Deploy app config + extensions to Shopify

```powershell
cmd /c npm exec --yes --package @shopify/cli@latest -- shopify app deploy --allow-updates
```

## 5) Ensure schema exists on main store

```powershell
npm run pricing:schema
```

## 6) Open app in main store

Open:
- `https://admin.shopify.com/store/bdsus/apps`

Click `Cart Transform-USA` and navigate to Pricing Rules page.

## Notes
- If app still opens old URL, run deploy again and hard refresh admin.
- If auth errors occur, verify:
  - Cloudflare URL is reachable and HTTPS
  - `BACKEND_ORIGIN` is correct
  - Backend `SHOPIFY_APP_URL` matches Worker URL exactly
- Do not use `application_url = "https://example.com"` in production/main-store testing.
