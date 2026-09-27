"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AnnouncementDTO } from "@snakeland/shared";
import { cn } from "@/lib/cn";
import { engagementApi } from "@/lib/engagement-api";
import { useSession } from "@/providers/session";

const STYLE: Record<string, string> = {
  info: "bg-elevated text-fg",
  success: "bg-win/12 text-win",
  warn: "bg-loss/12 text-loss",
};

/** A dismissible banner for the one active announcement. Dismissal is remembered per id. */
export function AnnouncementBanner() {
  const { me } = useSession();
  const [ann, setAnn] = useState<AnnouncementDTO | null>(null);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    engagementApi
      .announcement()
      .then(({ announcement }) => {
        if (cancelled || !announcement) return;
        try {
          if (localStorage.getItem(`snk:ann:${announcement.id}`)) return;
        } catch {
          /* ignore */
        }
        setAnn(announcement);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [me]);

  const dismiss = () => {
    if (ann) {
      try {
        localStorage.setItem(`snk:ann:${ann.id}`, "1");
      } catch {
        /* ignore */
      }
    }
    setAnn(null);
  };

  return (
    <AnimatePresence>
      {ann && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className={cn("overflow-hidden text-[13px]", STYLE[ann.level] ?? STYLE.info)}
        >
          <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1">
              {ann.body}
              {ann.href && /^(\/(?![\/\\])|https:\/\/)/.test(ann.href) && (
                <Link href={ann.href} className="ml-2 font-medium underline underline-offset-2">
                  Open
                </Link>
              )}
            </span>
            <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
