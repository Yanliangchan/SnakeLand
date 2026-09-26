import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request nonce-based Content Security Policy. Scripts only run if Next
 * stamped them with this request's nonce; the page may only talk to itself and
 * the API origin. Inline *style attributes* are allowed because Framer Motion
 * server-renders initial animation state as style="".
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const ws = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${ws}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // API traffic (proxied) is JSON; it needs no page CSP or nonce.
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$|manifest.webmanifest|api/|v1/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
