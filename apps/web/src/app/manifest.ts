import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "snakeland",
    short_name: "snakeland",
    description: "Six casino classics with virtual chips. Provably fair. No real money.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    categories: ["games", "entertainment"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Crash", url: "/play/crash" },
      { name: "Blackjack", url: "/play/blackjack" },
      { name: "Leaderboards", url: "/leaderboard" },
    ],
  };
}
