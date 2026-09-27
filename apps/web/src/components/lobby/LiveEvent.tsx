"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventSummaryDTO } from "@snakeland/shared";
import { useNow } from "@/components/events/EventPlay";
import { countdown, eventsApi } from "@/lib/events-api";
import { chips } from "@/lib/format";
import { fadeUp } from "@/lib/motion";
import { modeLabel } from "@/app/events/EventsView";

/** The live (or next) event, highlighted in the lobby. Renders nothing when there is none. */
export function LiveEvent() {
  const [event, setEvent] = useState<EventSummaryDTO | null>(null);
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    eventsApi
      .list()
      .then((r) => {
        if (cancelled) return;
        const live = r.events.find((e) => e.status === "live");
        const next = r.events.filter((e) => e.status === "scheduled").sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
        setEvent(live ?? next ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!event) return null;
  const live = event.status === "live";
  return (
    <motion.div {...fadeUp} className="mt-3">
      <Link
        href={`/events/${event.id}`}
        className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-[color-mix(in_srgb,var(--color-win)_8%,var(--color-surface))] px-4 py-3.5 transition-colors hairline hover:border-hairline-strong sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-win/15 text-win" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="truncate">{event.title}</span>
              {live && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-win" />}
            </span>
            <span className="block truncate text-[12px] text-fg-muted tabular">
              {modeLabel(event)} · pot {chips(event.pot)} · {live ? `${countdown(event.endsAt, now)} left` : `starts in ${countdown(event.startsAt, now)}`}
            </span>
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-win px-2.5 py-0.5 text-[11px] font-semibold text-black">{live ? "Live" : "Soon"}</span>
      </Link>
    </motion.div>
  );
}
