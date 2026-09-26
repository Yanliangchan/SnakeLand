"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Avatar, BalanceCounter } from "@/components/ui";
import { tap, tapTransition } from "@/lib/motion";
import { useSession } from "@/providers/session";

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[var(--tracking-tighter)]">
      <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="16" cy="16" r="3" fill="currentColor" />
      </svg>
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
          <div className="flex items-center gap-3">
            <motion.div whileTap={tap} transition={tapTransition}>
              <Link
                href="/wallet"
                className="flex h-9 items-center gap-2 rounded-[var(--radius-ui)] px-3 text-[14px] font-semibold hairline"
              >
                <BalanceCounter value={me.wallet.balance} />
                <span className="text-[12px] font-normal text-fg-muted">chips</span>
              </Link>
            </motion.div>
            <Link href="/settings" aria-label="Account and settings">
              <Avatar name={me.user.name} />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
