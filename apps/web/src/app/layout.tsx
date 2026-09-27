import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Providers } from "@/providers";
import { BottomNav } from "@/components/BottomNav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "snakeland", template: "%s · snakeland" },
  description: "Eleven casino games plus a hacking lab, with virtual chips. Provably fair. No real money.",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  // Installable: "Add to Home Screen" opens full screen, like an app.
  appleWebApp: { capable: true, title: "snakeland", statusBarStyle: "black-translucent" },
  applicationName: "snakeland",
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers opts every page into dynamic rendering, which the per-request CSP nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Set the theme before first paint so there's no flash of the wrong colours.
  const themeScript = `(function(){try{var p=JSON.parse(localStorage.getItem('snk:prefs')||'{}');var t=p.theme||'dark';var d=t==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;var e=document.documentElement;e.dataset.theme=d;e.style.colorScheme=d;}catch(e){}})();`;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          {children}
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
