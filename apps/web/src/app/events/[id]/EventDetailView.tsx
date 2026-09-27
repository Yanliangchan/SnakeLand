"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  EVENT_PRIZE_SPLIT,
  FFA_GAMES,
  GAMES,
  INSTANT_BET_LIMITS,
  RACE_CRASH_TARGET,
  type CrashRaceResultDTO,
  type EventDetailDTO,
} from "@snakeland/shared";
import { AppHeader } from "@/components/AppHeader";
import { ErrorState } from "@/components/ErrorState";
import { GameGlyph } from "@/components/GameGlyph";
import { useNow } from "@/components/events/EventPlay";
import { Button, ButtonLink, Card } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { countdown, eventsApi } from "@/lib/events-api";
import { chips, dateTime, signedChips } from "@/lib/format";
import { GAME_ACCENT } from "@/lib/games-ui";
import { fadeUp } from "@/lib/motion";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { StatusBadge, modeLabel } from "../EventsView";

const x = (x100: number) => `${(x100 / 100).toFixed(2)}×`;

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-[12px] bg-bg/50 px-3 py-2.5 hairline">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p className={cn("mt-0.5 text-[18px] font-semibold tabular", tone)}>{value}</p>
    </div>
  );
}

/** Crash race: pick a stake and a cash-out target; the crash point is fixed by the race seed. */
function CrashRace({ event, onResult }: { event: EventDetailDTO; onResult: (r: CrashRaceResultDTO) => void }) {
  const { play } = useSettings();
  const [bet, setBet] = useState("100");
  const [target, setTarget] = useState("2.00");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [result, setResult] = useState<CrashRaceResultDTO | null>(null);
  const [history, setHistory] = useState<CrashRaceResultDTO[]>([]);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const stack = event.me?.stack ?? 0;
  const left = event.me?.roundsLeft ?? 0;

  const launch = async () => {
    const b = Math.floor(Number(bet));
    const t = Math.round(Number(target) * 100);
    if (!Number.isFinite(b) || b < INSTANT_BET_LIMITS.min || b > Math.min(INSTANT_BET_LIMITS.max, stack)) {
      return setError(`Bet ${INSTANT_BET_LIMITS.min}–${chips(Math.min(INSTANT_BET_LIMITS.max, stack))} chips`);
    }
    if (!Number.isFinite(t) || t < RACE_CRASH_TARGET.min || t > RACE_CRASH_TARGET.max) return setError("Target is 1.01× to 1,000×");
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const r = await eventsApi.crash(event.id, b, t);
      play("whoosh");
      // Fly the multiplier up to the crash point (or the target, if we cashed out first).
      const end = r.won ? r.targetX100 : r.crashX100;
      const duration = Math.min(3200, 500 + Math.log(end / 100) * 1100);
      const start = performance.now();
      const step = (ts: number) => {
        const p = Math.min(1, (ts - start) / duration);
        setShown(Math.round(100 * Math.pow(end / 100, p)));
        if (p < 1) raf.current = requestAnimationFrame(step);
        else {
          setResult(r);
          setHistory((h) => [r, ...h].slice(0, 12));
          play(r.won ? "coin" : "lose");
          setPending(false);
          onResult(r);
        }
      };
      raf.current = requestAnimationFrame(step);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't launch");
      setPending(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold">Crash race</p>
        <p className="text-[12px] text-fg-muted tabular">{left} rounds left</p>
      </div>
      <div className="mt-3 grid place-items-center rounded-[12px] bg-bg/60 py-8 hairline">
        <p
          className={cn(
            "text-[48px] font-semibold leading-none tabular",
            result ? (result.won ? "text-win" : "text-loss") : "text-fg",
          )}
        >
          {shown ? x(shown) : "1.00×"}
        </p>
        <p className="mt-2 h-5 text-[13px] text-fg-muted">
          {result
            ? result.won
              ? `Cashed out at ${x(result.targetX100)} · +${chips(result.payout)} (crashed at ${x(result.crashX100)})`
              : `Crashed at ${x(result.crashX100)} before ${x(result.targetX100)}`
            : pending
              ? "Flying…"
              : "Everyone in this race gets the same crash points"}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-fg-muted">Bet</span>
          <input
            value={bet}
            onChange={(e) => setBet(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className="h-10 rounded-[var(--radius-ui)] bg-bg px-3 text-[14px] tabular outline-none hairline focus:border-fg/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-fg-muted">Cash out at (×)</span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="h-10 rounded-[var(--radius-ui)] bg-bg px-3 text-[14px] tabular outline-none hairline focus:border-fg/40"
          />
        </label>
        <Button onClick={launch} loading={pending} disabled={left === 0 || stack < INSTANT_BET_LIMITS.min}>
          Launch
        </Button>
      </div>
      {error && <p className="mt-2 text-[13px] text-loss">{error}</p>}
      {history.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {history.map((h) => (
            <span
              key={h.round}
              className={cn("rounded-full px-2 py-0.5 text-[11px] tabular", h.won ? "bg-win/15 text-win" : "bg-loss/10 text-loss")}
              title={`Round ${h.round + 1}`}
            >
              {x(h.crashX100)}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

export function EventDetailView({ id }: { id: string }) {
  const { me, refresh } = useSession();
  const [event, setEvent] = useState<EventDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const now = useNow();
  const live = event?.status === "live";

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      eventsApi
        .detail(id)
        .then((d) => {
          if (cancelled) return;
          setEvent(d);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof ApiError && e.status === 404 ? "This event doesn’t exist" : "Couldn’t load the event"));
    void load();
    // A live scoreboard refreshes every few seconds.
    const t = setInterval(load, live ? 3000 : 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id, reload, live]);

  const join = async () => {
    if (!event) return;
    if (event.buyIn > 0 && !window.confirm(`Join "${event.title}" for ${chips(event.buyIn)} chips?`)) return;
    setJoining(true);
    setJoinError(null);
    try {
      await eventsApi.join(event.id);
      await refresh();
      setReload((n) => n + 1);
    } catch (e) {
      setJoinError(e instanceof ApiError ? e.message : "Couldn't join");
    } finally {
      setJoining(false);
    }
  };

  if (!event) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto w-full max-w-5xl px-3 pt-10 sm:px-6">
          {error ? <ErrorState title={error} onRetry={() => setReload((n) => n + 1)} /> : <p className="py-16 text-center text-[13px] text-fg-muted">Loading…</p>}
        </main>
      </div>
    );
  }

  const e = event;
  const mine = e.me;
  const over = e.status === "ended" || e.status === "cancelled";

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-6 sm:px-6 sm:pt-10">
        <Link href="/events" className="text-[13px] text-fg-muted hover:text-fg">
          ← All events
        </Link>
        <motion.div {...fadeUp} className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusBadge status={e.status} />
              <span className="text-[13px] text-fg-muted">{modeLabel(e)}</span>
            </div>
            <h1 className="mt-2 text-[30px] font-semibold leading-tight">{e.title}</h1>
            <p className="mt-1 text-[13px] text-fg-muted tabular">
              {e.status === "live"
                ? `Ends in ${countdown(e.endsAt, now)}`
                : e.status === "scheduled"
                  ? `Starts in ${countdown(e.startsAt, now)}`
                  : e.status === "cancelled"
                    ? "Cancelled. Buy-ins were refunded."
                    : `Ended ${dateTime(e.endsAt)}`}
            </p>
          </div>
          {e.canJoin && (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={join} loading={joining} disabled={me?.user.isGuest}>
                {e.buyIn > 0 ? `Join · ${chips(e.buyIn)} chips` : "Join free"}
              </Button>
              {me?.user.isGuest && <p className="text-[12px] text-fg-muted">Create an account to join</p>}
              {joinError && <p className="text-[12px] text-loss">{joinError}</p>}
            </div>
          )}
        </motion.div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Prize pot" value={chips(e.pot)} tone="text-gold" />
          <Stat label="Starting stack" value={chips(e.stack)} />
          <Stat label="Players" value={e.entrants} />
          <Stat label="Top 3 share" value={<span className="text-[14px]">{EVENT_PRIZE_SPLIT.join(" / ")} %</span>} />
        </div>

        {mine && (
          <Card className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Your run</p>
                <p className="mt-1 text-[26px] font-semibold tabular">
                  {chips(mine.stack)}
                  <span className={cn("ml-2 text-[14px]", mine.stack >= e.stack ? "text-win" : "text-loss")}>{signedChips(mine.stack - e.stack)}</span>
                </p>
                <p className="text-[12px] text-fg-muted">
                  {mine.rank ? `#${mine.rank} · ` : ""}
                  {e.mode === "race"
                    ? `${mine.roundsPlayed}/${e.rounds} rounds played`
                    : mine.qualified
                      ? "Qualified for prizes"
                      : over
                        ? "Didn’t qualify for prizes"
                        : `Wager ${chips(Math.max(0, e.stack - mine.wagered))} more to qualify`}
                  {mine.payout ? ` · Won ${chips(mine.payout)}` : ""}
                </p>
              </div>
              {live && e.mode === "race" && e.game !== "crash" && e.game && (
                <ButtonLink href={`/play/${e.game}?event=${e.id}`} className={cn(mine.roundsLeft === 0 && "pointer-events-none opacity-40")}>
                  {mine.roundsLeft ? `Play ${GAMES[e.game].name}` : "All rounds played"}
                </ButtonLink>
              )}
            </div>
            {live && e.mode === "ffa" && (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {FFA_GAMES.map((g) => (
                  <Link
                    key={g}
                    href={`/play/${g}?event=${e.id}`}
                    className="flex flex-col items-center gap-1.5 rounded-[12px] bg-bg/50 px-2 py-3 text-[12px] font-medium transition-colors hairline hover:bg-elevated"
                  >
                    <span style={{ color: GAME_ACCENT[g] }}>
                      <GameGlyph game={g} size={24} />
                    </span>
                    {GAMES[g].name}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        )}

        {mine && live && e.game === "crash" && (
          <div className="mt-3">
            <CrashRace event={e} onResult={() => setReload((n) => n + 1)} />
          </div>
        )}

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_320px]">
          <Card padded={false} className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-[15px] font-semibold">Scoreboard</p>
              {live && <span className="text-[11px] text-fg-muted">Live</span>}
            </div>
            {e.standings.length === 0 ? (
              <p className="px-4 pb-6 text-[13px] text-fg-muted">No one has joined yet.</p>
            ) : (
              <ol className="divide-y divide-hairline">
                <AnimatePresence initial={false}>
                  {e.standings.map((s) => (
                    <motion.li
                      key={s.userId}
                      layout
                      className={cn("flex items-center gap-3 px-4 py-2.5 text-[13px]", s.userId === me?.user.id && "bg-gold/5")}
                    >
                      <span className={cn("w-6 text-right font-semibold tabular", s.rank <= 3 && s.qualified ? "text-gold" : "text-fg-muted")}>
                        {s.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {s.name}
                        {s.userId === me?.user.id && <span className="text-fg-muted"> (you)</span>}
                        {!s.qualified && <span className="ml-1.5 text-[11px] text-fg-disabled">{over ? "didn’t qualify" : "not qualified yet"}</span>}
                      </span>
                      <span className="hidden text-[12px] text-fg-muted tabular sm:inline">
                        {e.mode === "race" ? `${s.roundsPlayed}/${e.rounds}` : `${chips(s.wagered)} wagered`}
                      </span>
                      <span className="w-20 text-right font-semibold tabular">{chips(s.stack)}</span>
                      {over && <span className="w-16 text-right text-gold tabular">{s.payout ? `+${chips(s.payout)}` : ""}</span>}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            )}
          </Card>

          <Card className="h-fit text-[13px] text-fg-muted">
            <p className="text-[15px] font-semibold text-fg">How it works</p>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4">
              <li>Everyone starts with {chips(e.stack)} event chips. Your real balance isn’t used, apart from the entry fee.</li>
              {e.mode === "race" ? (
                <>
                  <li>
                    Play {e.rounds} rounds of {e.game ? GAMES[e.game].name : "the game"}. Every player gets the same{" "}
                    {e.game === "mines" ? "mine layouts" : e.game === "hilo" ? "cards" : "crash points"}, in the same order.
                  </li>
                  {e.mines && (
                    <li>
                      Board: {e.mines.size}×{e.mines.size} with {e.mines.mines} mines.
                    </li>
                  )}
                  <li>To win a prize, play all your rounds (or run out of chips) before the timer ends.</li>
                </>
              ) : (
                <>
                  <li>Play any of the instant games with your event stack until the timer ends.</li>
                  <li>To win a prize, wager at least your starting stack in total.</li>
                </>
              )}
              <li>Biggest final stacks win: 50% / 30% / 20% of the pot (shares scale up if fewer than three qualify). Ties share their places.</li>
            </ul>
            {e.commit && (
              <div className="mt-3 border-t border-hairline pt-3 text-[11px]">
                <p>Race seed commitment</p>
                <p className="mt-0.5 break-all font-mono text-fg">{e.commit}</p>
                {e.seed ? (
                  <>
                    <p className="mt-2">Race seed (revealed)</p>
                    <p className="mt-0.5 break-all font-mono text-fg">{e.seed}</p>
                  </>
                ) : (
                  <p className="mt-1">The seed is revealed when the event ends, so every round can be checked.</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
