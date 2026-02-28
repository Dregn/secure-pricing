# Cloudflare Main Store Deploy (Pricing Rules Form)

This is the shortest path to open your Pricing Rules form on the main store without running `shopify app dev`.

## Goal
- Host app backend on Cloudflare.
- Point Shopify app config to that hosted URL.
- Deploy app config + function.
- Open app in main store (`bdsus`) and use forms.

## 1) Deploy backend to Cloudflare

Deploy your React Router app using your Cloudflare setup/pipeline and get a live URL, for example:

- `https://secure-pricing-app.<subdomain>.workers.dev`

## 2) Update Shopify app URLs locally

Run:

```powershell
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
npm run config:set-app-url -- https://secure-pricing-app.<subdomain>.workers.dev
```

This updates:
- `shopify.app.cart-transform-usa.toml`
- `shopify.app.toml`
- `.env` (`SHOPIFY_APP_URL`)

## 3) Deploy app config + extensions to Shopify

```powershell
cmd /c npm exec --yes --package @shopify/cli@latest -- shopify app deploy --allow-updates
```

## 4) Ensure schema exists on main store

```powershell
npm run pricing:schema
```

## 5) Open app in main store

Open:
- `https://admin.shopify.com/store/bdsus/apps`

Click `Cart Transform-USA` and navigate to Pricing Rules page.

## Notes
- If app still opens old URL, run deploy again and hard refresh admin.
- If auth errors occur, verify Cloudflare URL is reachable and HTTPS.
- Do not use `application_url = "https://example.com"` in production/main-store testing.
