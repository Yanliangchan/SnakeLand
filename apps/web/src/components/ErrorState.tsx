"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui";
import { fadeUp } from "@/lib/motion";

/** Friendly failure card with a retry, for pages whose data didn't load. */
export function ErrorState({
  title = "Couldn’t load this",
  message = "The server didn’t answer. Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <motion.div {...fadeUp} className="flex flex-col items-center px-4 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full text-fg-muted hairline" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 8v5M12 16.5v.5" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <p className="mt-4 text-[15px] font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-[13px] text-fg-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </motion.div>
  );
}

/** Quiet placeholder when there's simply nothing to show yet. */
export function EmptyState({ title, message, action }: { title: string; message?: string; action?: React.ReactNode }) {
  return (
    <motion.div {...fadeUp} className="flex flex-col items-center px-4 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full text-fg-muted hairline" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 12h16M12 4v16" opacity="0.5" />
        </svg>
      </span>
      <p className="mt-4 text-[15px] font-medium">{title}</p>
      {message && <p className="mt-1 max-w-xs text-[13px] text-fg-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}
