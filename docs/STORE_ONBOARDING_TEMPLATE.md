# Store Onboarding Template

Use one copy of this per store.

## Store Details
- Store name:
- Store domain (`*.myshopify.com`):
- Environment: `dev` / `staging` / `prod`
- Region:
- Contact person:
- Date onboarded:

## App Details
- App client id:
- App installed: `yes/no`
- App URL:
- Embedded app opens successfully: `yes/no`

## Schema Setup
- `npm run pricing:schema` executed: `yes/no`
- Metaobject `pricing_rule` exists: `yes/no`
- Metafield `$app:pricing.pricing_rule` exists: `yes/no`

## Function Setup
- `npm run activate:transform` executed: `yes/no`
- Cart transform active in this store: `yes/no`
- Function extension version:

## Theme/Config Setup
- Theme name:
- Active theme id:
- Config source used by app:
  - `config/data.json` / `config/settings_data.json`
- Section keys to sync:
  - 1.
  - 2.
  - 3.

## Pricing Rule Sync
- Rule created from section key:
- Rule linked products count:
- `pricing_rule_json` updated on products: `yes/no`

## Checkout Validation
- Test product:
- Input used (width/height/unit/pieces):
- Expected total:
- Actual cart line unit price:
- Match result: `pass/fail`

## Commands Run
```bash
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
npm install
npm run pricing:schema
npm run activate:transform
npm run dev
```

## Known Issues / Notes
- 

## Sign-off
- Verified by:
- Verified on date:

