# Changelog

## 2026-02-25

### Added
- Scaffolded a new standalone Shopify app workspace in `secure-pricing-app`.
- Added secure pricing quote endpoint: `app/routes/api.custom-pricing.quote.ts`.
- Added shared trusted pricing engine: `app/lib/custom-pricing.ts`.
- Added product pricing rule loader from product metafield/metaobject: `app/lib/pricing-rule.server.ts`.
- Added setup script for pricing schema definitions:
  - `scripts/setup-pricing-schema.mjs`
  - `scripts/lib/shopify-admin.mjs`
- Added upsert/link script for per-product pricing rules:
  - `scripts/upsert-product-pricing-rule.mjs`
- Added sample pricing rule files:
  - `scripts/examples/pricing-rule.sample.json`
  - `scripts/examples/bdsus-product-8497406607552-pricing-rule.json`

### Changed
- Updated cart transform input query to consume raw pricing inputs instead of trusted client total:
  - `extensions/custom-pricing/src/cart_transform_run.graphql`
- Updated cart transform runtime pricing behavior:
  - recompute price from dimensions/pieces
  - enforce version and quantity checks
  - support width-based slab mode and overflow formula mode
  - file: `extensions/custom-pricing/src/cart_transform_run.ts`
- Updated app config and scripts:
  - extended scopes in `shopify.app.toml` and `.env`
  - added npm scripts in `package.json`
  - updated implementation notes in `README.md`
