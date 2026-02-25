import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { computeTrustedPrice } from "../lib/custom-pricing";
import { authenticate } from "../shopify.server";
import { getProductPricingRule } from "../lib/pricing-rule.server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function loader(_: LoaderFunctionArgs) {
  return jsonResponse({ ok: false, error: "method_not_allowed", use: "POST" }, 405);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed", use: "POST" }, 405);
  }

  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const productId = String(payload?.productId ?? "");
  if (!productId.startsWith("gid://shopify/Product/")) {
    return jsonResponse({ ok: false, error: "invalid_product_id" }, 422);
  }

  const { admin } = await authenticate.admin(request);
  const rule = await getProductPricingRule(admin as any, productId);
  if (!rule) {
    return jsonResponse({ ok: false, error: "missing_product_pricing_rule" }, 422);
  }

  const result = computeTrustedPrice({
    source: String(payload?.source ?? ""),
    width: Number(payload?.width),
    height: Number(payload?.height),
    unit: String(payload?.unit ?? ""),
    pieces: Number(payload?.pieces),
    optionAmounts: Array.isArray(payload?.optionAmounts)
      ? payload.optionAmounts.map((v: unknown) => Number(v))
      : [],
  }, rule);

  if (!result.ok) {
    return jsonResponse({ ok: false, error: result.reason }, 422);
  }

  return jsonResponse({
    ok: true,
    total: result.total,
    unitPrice: result.unitPrice,
    normalized: {
      source: result.source,
      pieces: result.pieces,
      areaPerPieceSqFt: result.areaPerPieceSqFt,
      totalAreaSqFt: result.totalAreaSqFt,
    },
  });
}
