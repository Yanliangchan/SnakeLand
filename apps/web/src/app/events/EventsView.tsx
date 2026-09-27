"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventSummaryDTO } from "@snakeland/shared";
import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState } from "@/components/ErrorState";
import { useNow } from "@/components/events/EventPlay";
import { CardGridSkeleton } from "@/components/Skeleton";
import { cn } from "@/lib/cn";
import { RACE_GAME_NAME, countdown, eventsApi } from "@/lib/events-api";
import { chips } from "@/lib/format";
import { expoOut, fadeUp } from "@/lib/motion";

export function StatusBadge({ status }: { status: EventSummaryDTO["status"] }) {
  const tone = {
    live: "bg-win/15 text-win",
    scheduled: "bg-gold/15 text-gold",
    ended: "bg-elevated text-fg-muted",
    cancelled: "bg-loss/10 text-loss",
  }[status];
  return (
    <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", tone)}>
      {status === "live" && <span className="size-1.5 animate-pulse rounded-full bg-win" />}
      {status === "scheduled" ? "Upcoming" : status}
    </span>
  );
}

export const modeLabel = (e: Pick<EventSummaryDTO, "mode" | "game" | "rounds">) =>
  e.mode === "race" && e.game ? `${RACE_GAME_NAME[e.game]} race · ${e.rounds} rounds` : "Free-for-all";

export function EventCard({ e, now, i = 0 }: { e: EventSummaryDTO; now: number; i?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: expoOut, delay: Math.min(i, 8) * 0.04 }}
    >
      <Link
        href={`/events/${e.id}`}
        className={cn(
          "flex h-full flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-4 transition-colors hairline hover:bg-elevated",
          e.status === "live" && "border-win/40",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-fg-muted">{modeLabel(e)}</span>
          <StatusBadge status={e.status} />
        </div>
        <p className="text-[18px] font-semibold leading-tight">{e.title}</p>
        <div className="mt-auto grid grid-cols-3 gap-2 text-[12px]">
          <div>
            <p className="font-semibold text-gold tabular">{chips(e.pot)}</p>
            <p className="text-fg-muted">pot</p>
          </div>
          <div>
            <p className="font-semibold tabular">{e.buyIn ? chips(e.buyIn) : "Free"}</p>
            <p className="text-fg-muted">entry</p>
          </div>
          <div>
            <p className="font-semibold tabular">
              {e.status === "live" ? countdown(e.endsAt, now) : e.status === "scheduled" ? countdown(e.startsAt, now) : e.entrants}
            </p>
            <p className="text-fg-muted">{e.status === "live" ? "left" : e.status === "scheduled" ? "to start" : "players"}</p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function EventsView() {
  const [list, setList] = useState<EventSummaryDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      eventsApi
        .list()
        .then((r) => {
          if (cancelled) return;
          setList(r.events);
          setError(false);
        })
        .catch(() => !cancelled && setError(true));
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [reload]);

  const active = list?.filter((e) => e.status === "live" || e.status === "scheduled") ?? [];
  const past = list?.filter((e) => e.status === "ended" || e.status === "cancelled") ?? [];

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-6 sm:px-6 sm:pt-10">
        <motion.div {...fadeUp}>
          <h1 className="text-[32px] font-semibold leading-none">Events</h1>
          <p className="mt-2 max-w-lg text-[13px] text-fg-muted">
            Everyone starts with the same event stack. Races play identical rounds; free-for-alls let you play any game. The best three
            stacks split the pot 50/30/20.
          </p>
        </motion.div>

        <div className="mt-6">
          {!list ? (
            error ? (
              <ErrorState title="Couldn’t load events" onRetry={() => setReload((n) => n + 1)} />
            ) : (
              <CardGridSkeleton count={3} />
            )
          ) : active.length === 0 ? (
            <EmptyState title="No events right now" message="Keep an eye on the lobby. New events are announced there." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((e, i) => (
                <EventCard key={e.id} e={e} now={now} i={i} />
              ))}
            </div>
          )}
        </div>

        {past.length > 0 && (
          <>
            <h2 className="mt-8 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Recent</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {past.map((e, i) => (
                <EventCard key={e.id} e={e} now={now} i={i} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
