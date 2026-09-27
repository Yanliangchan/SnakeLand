import type { NextRequest } from "next/server";

/**
 * Same-origin gateway to the API. The browser only ever talks to this app,
 * so the session cookie is first-party; requests are forwarded over the
 * private network with a fixed allow-list of headers.
 */

const MAX_BODY = 64 * 1024;
const REQUEST_HEADERS = ["accept", "accept-language", "content-type", "cookie", "origin", "referer", "user-agent", "x-snk-event"];
const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "set-cookie"]);
const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

async function readBody(req: NextRequest): Promise<ArrayBuffer | null | "too-large"> {
  if (req.method === "GET" || req.method === "HEAD" || !req.body) return null;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return "too-large";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

export async function proxyToApi(req: NextRequest): Promise<Response> {
  const base = process.env.API_INTERNAL_URL;
  if (!base) return error(502, "GATEWAY_MISCONFIGURED", "The API is not configured");

  const body = await readBody(req);
  if (body === "too-large") return error(413, "PAYLOAD_TOO_LARGE", "Request too large");

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  // Pass on the client IP the edge saw (Railway sets X-Real-IP); never trust other client-sent values.
  const ip = req.headers.get("x-real-ip")?.trim();
  if (ip && IP_RE.test(ip)) headers.set("x-real-ip", ip);

  let upstream: Response;
  try {
    upstream = await fetch(new URL(req.nextUrl.pathname + req.nextUrl.search, base), {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return error(502, "UPSTREAM_UNAVAILABLE", "The game server is unavailable. Try again shortly.");
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key)) out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
