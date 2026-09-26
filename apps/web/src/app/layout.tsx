import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Providers } from "@/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "snakeland", template: "%s · snakeland" },
  description: "Six casino classics with virtual chips. Provably fair. No real money.",
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
  await headers();
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
