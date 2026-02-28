# Deployment Change Summary

This document summarizes key app changes made for pricing-rule management and what matters when deploying to another store.

## 1) Pricing Rules Admin UI

Implemented in:
- `app/routes/app.pricing-rules.tsx`

### Added
- New embedded app page to manage pricing rules.
- Rule list + create/update forms.
- Product linking for each rule.
- Theme sync action:
  - Enter `Rule Name` + `Section Key`
  - Click **Sync from theme config**
  - App fetches section config and fills source/slabs/options.

### UI updates made
- Create/Update forms now use full width (stacked cards).
- Removed unused fields from form:
  - `Overflow Unit Rate`
  - `Shipping Surcharge`
- JSON editors improved:
  - Larger textareas
  - Monospace
  - Spellcheck/autocorrect/autocomplete disabled

### Sync behavior
- Save now always auto-syncs linked products’ `pricing_rule_json` (checkbox removed).

---

## 2) Theme Config Sync Source

Implemented in:
- `app/lib/theme-pricing-settings.server.ts`

### Behavior
- Reads active theme files in order:
  1. `config/data.json`
  2. fallback: `config/settings_data.json`
- Supports JSON with:
  - comments (`/* ... */`, `// ...`)
  - trailing commas
- Extracts pricing profiles from sections that contain `width_range` blocks.

---

## 3) Validation Changes

Implemented in:
- `app/lib/pricing-rules-admin.server.ts`

### Current validation policy (intentionally minimal)
- `Rule Name` required
- `Source` required
- `Slabs JSON` must be array
- `Options JSON` must be object

### Removed strict checks
- Overlap/gap slab validation
- Strict numeric-only options validation

Reason:
- Synced store data uses nested options + shipping structures and touching slab boundaries.

---

## 4) Product Sync / Cart Transform Data Path

### On save
- Rule metaobject is created/updated.
- Linked products are updated with:
  - `pricing_rule` (metaobject reference)
  - `pricing_rule_json` (for cart transform)

### Cart transform source
- Runtime pricing uses product `pricing_rule_json`.
- Ensure product sync is successful after each rule change.

---

## 5) Runtime Formula Notes (Important)

Checkout transform currently computes from:
- width, height, unit, pieces
- slab `amount` (+ slab `shipping`)
- options group selections
- shipping option percent from `options.shipping`
- overflow via last slab rate + overflow markup

Current transform does **not** use:
- `shipping_surcharge`
- `overflow_unit_rate`

These exist in schema and server helper paths but are not part of current transform formula.

---

## 6) Required Store Setup Before Use

Run for each store:

```bash
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
npm run pricing:schema
npm run activate:transform
```

This ensures:
- `pricing_rule` metaobject definition exists
- `$app:pricing.pricing_rule` product metafield definition exists
- Cart transform is active

---

## 7) Known Operational Issues

### Prisma EPERM on Windows
- File lock on Prisma engine can break `npm run dev`.
- See:
  - `docs/ISSUE_RUNBOOK.md`

### Store mismatch risk
- Scripts may target a different store than current app session.
- Always verify target store in:
  - `scripts/shopify-admin.config.mjs`

---

## 8) Recommended Deployment Flow for New Store

1. Ensure app is available in target store admin (via your existing app install link).
2. Run deploy:
   - `cmd /c npm exec --yes --package @shopify/cli@latest -- shopify app deploy --allow-updates`
3. Run schema + transform setup commands.
4. Verify app opens in admin preview.
5. Sync one known section key (example: `product-test-fabric`).
6. Save rule and verify linked product `pricing_rule_json` updated.
7. Add test cart item and verify transformed unit price.

For checklist format, use:
- `docs/STORE_ONBOARDING_TEMPLATE.md`
