"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useSession } from "@/providers/session";

const ITEMS = [
  { href: "/", label: "Lobby", match: (p: string) => p === "/", icon: "M3 11l9-7 9 7M5 10v10h14V10" },
  { href: "/lab", label: "Lab", match: (p: string) => p.startsWith("/lab"), icon: "M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3M7.5 15h9" },
  { href: "/leaderboard", label: "Ranks", match: (p: string) => p.startsWith("/leaderboard"), icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" },
  { href: "/wallet", label: "Wallet", match: (p: string) => p.startsWith("/wallet"), icon: "M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0V6a2 2 0 0 1 2-2h11M17 13h.01" },
  { href: "/profile", label: "Profile", match: (p: string) => p.startsWith("/profile") || p.startsWith("/settings"), icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21a7 7 0 0 1 14 0" },
];

// Full-screen game and admin routes get no bottom bar.
const HIDDEN = (p: string) => p.startsWith("/play") || p.startsWith("/admin") || p.startsWith("/sign-");

/** A phone-only bottom tab bar for the main sections. Hidden on games, admin and when signed out. */
export function BottomNav() {
  const pathname = usePathname();
  const { me } = useSession();
  if (!me || HIDDEN(pathname)) return null;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-hairline bg-bg/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      {ITEMS.map((it) => {
        const active = it.match(pathname);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors", active ? "text-fg" : "text-fg-muted")}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={it.icon} />
            </svg>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
