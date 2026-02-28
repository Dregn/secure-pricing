const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

function getBackendOrigin(env) {
  const raw = String(env.BACKEND_ORIGIN || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return null;
  }
}

function buildUpstreamUrl(requestUrl, backendOrigin) {
  const incoming = new URL(requestUrl);
  const upstream = new URL(incoming.pathname + incoming.search, backendOrigin);
  return upstream.toString();
}

function buildForwardHeaders(request) {
  const headers = new Headers(request.headers);

  for (const key of HOP_BY_HOP_HEADERS) {
    headers.delete(key);
  }

  const incoming = new URL(request.url);
  const clientIp = request.headers.get("cf-connecting-ip");

  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  if (clientIp) headers.set("x-forwarded-for", clientIp);

  return headers;
}

function json(message, status = 500) {
  return new Response(JSON.stringify(message, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/_cf_proxy_health") {
      return json({ ok: true, service: "secure-pricing-cloudflare-proxy" }, 200);
    }

    const backendOrigin = getBackendOrigin(env);
    if (!backendOrigin) {
      return json(
        {
          ok: false,
          error: "Missing or invalid BACKEND_ORIGIN env var",
          expected: "https://your-node-backend.example.com",
        },
        500,
      );
    }

    const upstreamUrl = buildUpstreamUrl(request.url, backendOrigin);
    const headers = buildForwardHeaders(request);

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    try {
      const upstreamResponse = await fetch(upstreamUrl, init);
      const responseHeaders = new Headers(upstreamResponse.headers);
      for (const key of HOP_BY_HOP_HEADERS) {
        responseHeaders.delete(key);
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return json(
        {
          ok: false,
          error: "Proxy request failed",
          upstreamUrl,
          details: String(error && error.message ? error.message : error),
        },
        502,
      );
    }
  },
};
