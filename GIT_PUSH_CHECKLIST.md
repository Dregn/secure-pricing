# Git Push Checklist

Use this checklist when pushing this project so another machine can clone and run safely.

## Push These

- `app/**`
- `extensions/**`
- `scripts/**` (except local secret config file)
- `package.json`
- `package-lock.json`
- `shopify.app.cart-transform-usa.toml` (active app config)
- `shopify.web.toml`
- `tsconfig.json`
- `vite.config.ts`
- `README.md`
- `RUNBOOK.md` (if present)
- `graphql/**` helper files (if present)

## Do Not Push

- `node_modules/`
- `.env` and `.env.*`
- `tmp/**` outputs
- `temp_*.mjs` debug files
- `scripts/shopify-admin.config.mjs` (contains local credentials)

## Secret Config Pattern

1. Keep `scripts/shopify-admin.config.example.mjs` in git.
2. On each machine:
   - copy example to `scripts/shopify-admin.config.mjs`
   - fill store domain / token / credentials locally

## New Machine Setup

1. `npm install`
2. Create local env files and `scripts/shopify-admin.config.mjs`
3. Run required scripts (schema/sync/verify)
4. Deploy only when ready:
   - `npm run deploy -- --allow-updates`

