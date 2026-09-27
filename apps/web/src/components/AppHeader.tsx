"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Avatar, BalanceCounter } from "@/components/ui";
import { tap, tapTransition } from "@/lib/motion";
import { useSession } from "@/providers/session";

/** The chip-stack mark: a solid top chip over two fading outlined ones. */
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <ellipse cx="16" cy="22" rx="9" ry="3.6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />
      <ellipse cx="16" cy="16.5" rx="9" ry="3.6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7" />
      <ellipse cx="16" cy="11" rx="9" ry="3.6" fill="currentColor" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[var(--tracking-tighter)]">
      <LogoMark size={20} />
      snakeland
    </Link>
  );
}

export function AppHeader() {
  const { me } = useSession();
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-3 sm:h-16 sm:px-4 lg:px-6">
        <Wordmark />
        {me && (
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/lab"
              aria-label="The Lab"
              className="grid size-9 place-items-center rounded-[var(--radius-ui)] text-fg-muted transition-colors hover:text-fg"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3" />
                <path d="M7.5 15h9" />
              </svg>
            </Link>
            <Link
              href="/leaderboard"
              aria-label="Leaderboards"
              className="grid size-9 place-items-center rounded-[var(--radius-ui)] text-fg-muted transition-colors hover:text-fg"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
                <path d="M17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />
              </svg>
            </Link>
            <motion.div whileTap={tap} transition={tapTransition}>
              <Link
                href="/wallet"
                className="flex h-9 items-center gap-2 rounded-[var(--radius-ui)] px-3 text-[14px] font-semibold hairline"
              >
                <BalanceCounter value={me.wallet.balance} />
                <span className="text-[12px] font-normal text-fg-muted">chips</span>
              </Link>
            </motion.div>
            <Link href="/profile" aria-label="Your profile">
              <Avatar name={me.user.name} />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
