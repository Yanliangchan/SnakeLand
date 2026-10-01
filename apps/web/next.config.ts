import path from "node:path";
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const config: NextConfig = {
  poweredByHeader: false,
  // A self-contained server with only the files it needs: smaller deploy, less memory than `next start`.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  reactStrictMode: true,
  transpilePackages: ["@snakeland/shared"],
  // No next/image in the app: keep the optimizer (and its /_next/image endpoint) off.
  images: { unoptimized: true },
  experimental: {
    // Pages are rendered per request (CSP nonce) but carry no player data:
    // that is fetched client-side. Reuse prefetched pages for 5 minutes
    // instead of re-downloading every link in view every 30 seconds.
    staleTimes: { dynamic: 300, static: 300 },
  },
  agentRules: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker must never be served stale.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      // Icons aren't content-hashed, so cache them for a day rather than forever.
      { source: "/:icon(icon.*|apple-touch-icon.png)", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default config;
