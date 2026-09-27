"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EVENT_LIMITS, RACE_GAMES, type AdminEventInput, type EventMode, type EventSummaryDTO, type RaceGame } from "@snakeland/shared";
import { ErrorState } from "@/components/ErrorState";
import { Button, Card } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { RACE_GAME_NAME, adminEventsApi } from "@/lib/events-api";
import { chips, dateTime } from "@/lib/format";
import { StatusBadge, modeLabel } from "../../events/EventsView";
import { useAdminExpired } from "../AdminFrame";

const input = "h-10 w-full rounded-[var(--radius-ui)] bg-bg px-3 text-[14px] outline-none hairline focus:border-fg/40";

function Label({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[12px] text-fg-muted">{text}</span>
      {children}
    </label>
  );
}

/** `datetime-local` value for a Date, in the admin's own time zone. */
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const num = (v: string) => Math.floor(Number(v) || 0);

function Creator({ onDone }: { onDone: () => void }) {
  const expired = useAdminExpired();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<EventMode>("ffa");
  const [game, setGame] = useState<RaceGame>("mines");
  const [rounds, setRounds] = useState("10");
  const [size, setSize] = useState("5");
  const [minesN, setMinesN] = useState("3");
  const [startsAt, setStartsAt] = useState(() => localInput(new Date(Date.now() + 5 * 60_000)));
  const [minutes, setMinutes] = useState("30");
  const [stack, setStack] = useState("10000");
  const [buyIn, setBuyIn] = useState("500");
  const [topUp, setTopUp] = useState("5000");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: AdminEventInput = {
      title: title.trim(),
      mode,
      game: mode === "race" ? game : null,
      startsAt: new Date(startsAt).toISOString(),
      minutes: num(minutes),
      stack: num(stack),
      buyIn: num(buyIn),
      topUp: num(topUp),
      rounds: mode === "race" ? num(rounds) : null,
      mines: mode === "race" && game === "mines" ? { size: num(size), mines: num(minesN) } : null,
    };
    setPending(true);
    setError(null);
    try {
      await adminEventsApi.create(body);
      setTitle("");
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return expired();
      setError(err instanceof ApiError ? err.message : "Couldn't create the event");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <p className="text-[15px] font-semibold">New event</p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Label text="Title" className="sm:col-span-2">
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required placeholder="Friday night Mines race" />
        </Label>
        <Label text="Format">
          <select className={input} value={mode} onChange={(e) => setMode(e.target.value as EventMode)}>
            <option value="ffa">Free-for-all (any instant game)</option>
            <option value="race">Same-seed race</option>
          </select>
        </Label>
        {mode === "race" ? (
          <Label text="Race game">
            <select className={input} value={game} onChange={(e) => setGame(e.target.value as RaceGame)}>
              {RACE_GAMES.map((g) => (
                <option key={g} value={g}>
                  {RACE_GAME_NAME[g]}
                </option>
              ))}
            </select>
          </Label>
        ) : (
          <div />
        )}
        {mode === "race" && (
          <Label text={`Rounds per player (${EVENT_LIMITS.rounds.min}–${EVENT_LIMITS.rounds.max})`}>
            <input className={cn(input, "tabular")} inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />
          </Label>
        )}
        {mode === "race" && game === "mines" && (
          <div className="grid grid-cols-2 gap-3">
            <Label text="Board (3–8)">
              <input className={cn(input, "tabular")} inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
            </Label>
            <Label text="Mines">
              <input className={cn(input, "tabular")} inputMode="numeric" value={minesN} onChange={(e) => setMinesN(e.target.value)} />
            </Label>
          </div>
        )}
        <Label text="Starts at (your time)">
          <input className={input} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </Label>
        <Label text="Duration (minutes)">
          <input className={cn(input, "tabular")} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Label>
        <Label text="Starting event stack">
          <input className={cn(input, "tabular")} inputMode="numeric" value={stack} onChange={(e) => setStack(e.target.value)} />
        </Label>
        <Label text="Buy-in (0 for free)">
          <input className={cn(input, "tabular")} inputMode="numeric" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} />
        </Label>
        <Label text="Your top-up to the pot">
          <input className={cn(input, "tabular")} inputMode="numeric" value={topUp} onChange={(e) => setTopUp(e.target.value)} />
        </Label>
        <div className="flex items-end justify-end sm:col-span-2">
          <Button type="submit" loading={pending} disabled={!title.trim()}>
            Create event
          </Button>
        </div>
        {error && <p className="text-[13px] text-loss sm:col-span-2">{error}</p>}
      </form>
    </Card>
  );
}

export function AdminEvents() {
  const expired = useAdminExpired();
  const [items, setItems] = useState<EventSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminEventsApi
      .list()
      .then((r) => !cancelled && setItems(r.events))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) expired();
        else setError("Couldn't load events");
      });
    return () => {
      cancelled = true;
    };
  }, [reload, expired]);

  const cancel = async (e: EventSummaryDTO) => {
    if (!window.confirm(`Cancel "${e.title}"? Buy-ins are refunded.`)) return;
    try {
      await adminEventsApi.cancel(e.id);
      setReload((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expired();
      else window.alert(err instanceof ApiError ? err.message : "Couldn't cancel");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 pb-16 pt-6 sm:px-6">
      <div>
        <h1 className="text-[24px] font-semibold">Events</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Races and free-for-alls with an equal event stack. The pot (buy-ins + your top-up) pays 50/30/20 when the window closes.
        </p>
      </div>
      <Creator onDone={() => setReload((n) => n + 1)} />
      {!items ? (
        error ? (
          <ErrorState title={error} onRetry={() => setReload((n) => n + 1)} />
        ) : (
          <p className="py-10 text-center text-[13px] text-fg-muted">Loading…</p>
        )
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-fg-muted">No events yet.</p>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-hairline">
            {items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[14px] font-medium">
                    <Link href={`/events/${e.id}`} className="hover:underline">
                      {e.title}
                    </Link>
                    <StatusBadge status={e.status} />
                  </p>
                  <p className="text-[12px] text-fg-muted">
                    {modeLabel(e)} · {dateTime(e.startsAt)} → {dateTime(e.endsAt)} · {e.entrants} players · pot {chips(e.pot)} · entry{" "}
                    {e.buyIn ? chips(e.buyIn) : "free"}
                  </p>
                </div>
                {(e.status === "scheduled" || e.status === "live") && (
                  <Button variant="ghost" size="sm" onClick={() => void cancel(e)}>
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
