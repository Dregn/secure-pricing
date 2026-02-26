import type { LoaderFunctionArgs } from "react-router";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "unknown";
  const productId = url.searchParams.get("product_id") || "";
  const source = url.searchParams.get("source") || "unknown";
  const ts = new Date().toISOString();

  // Visible in the terminal running `shopify app dev` (or your app host logs).
  console.log(`[public-ping] shop=${shop} source=${source} product_id=${productId} at=${ts}`);

  return jsonResponse({
    ok: true,
    message: "App connection reachable",
    shop,
    source,
    productId,
    at: ts,
  });
}
