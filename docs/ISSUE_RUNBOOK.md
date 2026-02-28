# Issue Runbook

## 1) `No metaobject definition exists for type "pricing_rule"`

### Symptom
- Create Rule fails with:
  - `Error: No metaobject definition exists for type "pricing_rule"`

### Cause
- The target store does not have required schema objects:
  - Metaobject definition: `pricing_rule`
  - Product metafield definition: `$app:pricing.pricing_rule` (metaobject reference)

### Fix
Run schema setup against the same store you are testing:

```bash
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
npm run pricing:schema
```

### Verify
- Output should show either:
  - `Metaobject definition exists...`
  - or `Created metaobject definition...`
- and:
  - `Product metafield definition exists...`
  - or `Created product metafield definition...`

---

## 2) Windows Prisma error (`EPERM ... query_engine-windows.dll.node`)

### Symptom
- `npm run dev` fails during `npx prisma generate` with:
  - `EPERM: operation not permitted, rename ... query_engine-windows.dll.node.tmp...`

### Cause
- Prisma engine DLL is file-locked (usually by a Node process, Defender, or sync tools).

### Fix steps

```powershell
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
taskkill /F /IM node.exe
Remove-Item -Recurse -Force ".\node_modules\.prisma\client" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\node_modules\@prisma\client" -ErrorAction SilentlyContinue
npm install
npx prisma generate
npm run dev
```

### If still failing
- Temporarily pause antivirus real-time scanning.
- Pause OneDrive/Dropbox sync for project folder.
- Retry:

```powershell
npx prisma generate
npm run dev
```

---

## 3) Quick sanity checks before testing

```bash
npm run typecheck
npm run pricing:schema
npm run activate:transform
```

---

## 4) Shopify CLI command not found / wrong argument parsing

### Symptom A
- `shopify : The term 'shopify' is not recognized...`

### Cause A
- Shopify CLI is not installed globally (or not on PATH).

### Fix A
Use local CLI via npm exec:

```powershell
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
cmd /c npm exec --yes --package @shopify/cli@latest -- shopify app dev -- --store=bdsus.myshopify.com
```

### Symptom B
- Prompt shows:
  - `Command app dev bdsus.myshopify.com not found`

### Cause B
- `--store` argument was not passed correctly through `npm exec` and got interpreted as a positional command token.

### Fix B
Use one of these exact formats:

```powershell
cmd /c npm exec --yes --package @shopify/cli@latest -- shopify app dev -- --store=bdsus.myshopify.com
```

or

```powershell
cmd /c npm exec --yes --package @shopify/cli@latest -- shopify app dev -s bdsus.myshopify.com
```

---

## 5) `shopify app install` not found (CLI command mismatch)

### Symptom
- Running:
  - `npm exec --yes --package @shopify/cli@latest -- shopify app install --store bdsus.myshopify.com`
- Returns:
  - `Command app install not found`
- If user confirms prompt, CLI may run:
  - `app import-custom-data-definitions`

### Cause
- `app install` is not supported in this CLI flow/version.
- Command suggestion can lead to a different command if confirmed.

### Impact
- `app import-custom-data-definitions` is read/convert behavior (prints TOML).
- It does **not** install app and does **not** delete store data.

### Correct flow
Deploy and configure app/extensions instead:

```powershell
cd "C:\Users\datta\Documents\Shopify Pricing App\secure-pricing-app"
cmd /c npm exec --yes --package @shopify/cli@latest -- shopify app deploy --allow-updates
npm run pricing:schema
npm run activate:transform
```

### Optional verify
- Open app in admin and confirm pricing rules page loads.
- Confirm one rule save updates linked products `pricing_rule_json`.
