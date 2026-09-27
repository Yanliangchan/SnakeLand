"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { EventDetailDTO, WalletDTO } from "@snakeland/shared";
import { FullScreenLoader } from "@/components/FullScreenLoader";
import { setEventPlay } from "@/lib/api";
import { chips } from "@/lib/format";
import { countdown, eventsApi } from "@/lib/events-api";
import { SessionOverride, useSession } from "@/providers/session";

interface EventPlayValue {
  event: EventDetailDTO;
}

const EventPlayContext = createContext<EventPlayValue | null>(null);

/** The event a game is being played in, or null for normal wallet play. */
export function useEventPlay() {
  return useContext(EventPlayContext);
}

/** Ticks every second for countdowns. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Plays a game with an event stack: every API call carries the event id, and
 * the balance the game sees (and updates) is the event stack, not the wallet.
 */
export function EventPlay({ eventId, children }: { eventId: string; children: React.ReactNode }) {
  const session = useSession();
  const [event, setEvent] = useState<EventDetailDTO | null>(null);
  const [stack, setStack] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The header must be in place before the game mounts and fetches its state.
  useEffect(() => {
    setEventPlay(eventId);
    let cancelled = false;
    const load = () =>
      eventsApi
        .detail(eventId)
        .then((d) => {
          if (cancelled) return;
          setEvent(d);
          if (d.me) setStack(d.me.stack);
        })
        .catch(() => !cancelled && setError("Couldn't load the event"));
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
      setEventPlay(null);
    };
  }, [eventId]);

  const setWallet = useCallback((w: Partial<WalletDTO>) => {
    if (typeof w.balance === "number") setStack(w.balance);
  }, []);

  const value = useMemo(
    () =>
      session.me && stack !== null
        ? { ...session, me: { ...session.me, wallet: { ...session.me.wallet, balance: stack } }, setWallet }
        : session,
    [session, stack, setWallet],
  );
  const ctx = useMemo(() => (event ? { event } : null), [event]);

  if (error) return <EventProblem text={error} eventId={eventId} />;
  if (!event) return <FullScreenLoader />;
  if (!event.me) return <EventProblem text="Join this event to play in it." eventId={eventId} />;
  if (event.status !== "live") {
    return <EventProblem text={event.status === "scheduled" ? "This event hasn't started yet." : "This event is over."} eventId={eventId} />;
  }
  return (
    <EventPlayContext.Provider value={ctx}>
      <SessionOverride value={value}>{children}</SessionOverride>
    </EventPlayContext.Provider>
  );
}

function EventProblem({ text, eventId }: { text: string; eventId: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-[15px]">{text}</p>
        <Link href={`/events/${eventId}`} className="mt-3 inline-block text-[13px] text-fg-muted underline underline-offset-4 hover:text-fg">
          Back to the event
        </Link>
      </div>
    </main>
  );
}

/** Slim bar under the game header while playing an event. */
export function EventStrip() {
  const ctx = useEventPlay();
  const now = useNow();
  const { me } = useSession();
  if (!ctx) return null;
  const e = ctx.event;
  const left = e.me?.roundsLeft;
  return (
    <div className="shrink-0 border-b border-hairline bg-[color-mix(in_srgb,var(--color-gold)_8%,var(--color-bg))]">
      <div className="mx-auto flex h-9 w-full max-w-[1440px] items-center gap-3 px-3 text-[12px] sm:px-4">
        <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-black">
          {e.mode === "race" ? "Race" : "Event"}
        </span>
        <span className="min-w-0 truncate font-medium">{e.title}</span>
        <span className="text-fg-muted tabular">{countdown(e.endsAt, now)} left</span>
        {left !== null && left !== undefined && <span className="hidden text-fg-muted tabular sm:inline">{left} rounds left</span>}
        <span className="hidden text-fg-muted sm:inline">
          Stack <span className="font-semibold text-fg tabular">{chips(me?.wallet.balance ?? 0)}</span>
        </span>
        <Link href={`/events/${e.id}`} className="ml-auto shrink-0 text-fg-muted underline-offset-2 hover:text-fg hover:underline">
          Scoreboard →
        </Link>
      </div>
    </div>
  );
}
