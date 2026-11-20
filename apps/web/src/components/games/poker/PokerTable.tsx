"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { POKER_SEATS, type Card, type PokerSeatDTO, type PokerTableDTO } from "@snakeland/shared";
import { PlayingCard } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Seat spots around the oval, as % of the stage: 0 is the bottom centre (you), then clockwise. */
const SPOTS = [
  { x: 50, y: 86 },
  { x: 12, y: 66 },
  { x: 14, y: 22 },
  { x: 50, y: 12 },
  { x: 86, y: 22 },
  { x: 88, y: 66 },
] as const;

/** Where a seat's bet sits: pulled towards the middle of the table. */
const toward = (p: { x: number; y: number }, k: number) => ({ x: 50 + (p.x - 50) * k, y: 48 + (p.y - 48) * k });

const fmt = (n: number) => n.toLocaleString();
const ACTION_LABEL = { fold: "Fold", check: "Check", call: "Call", bet: "Bet", raise: "Raise", allin: "All in" } as const;

function useCountdown(deadline: string | null, offsetMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Date.parse(deadline) - (now + offsetMs));
}

/** Time left on a player's turn: a bar along the bottom of their nameplate. */
function TurnTimer({ msLeft, totalMs }: { msLeft: number; totalMs: number }) {
  const frac = Math.max(0, Math.min(1, msLeft / totalMs));
  return (
    <span aria-hidden className="pointer-events-none absolute inset-x-2 bottom-1 h-[3px] overflow-hidden rounded-full bg-white/10">
      <span
        className="block h-full rounded-full"
        style={{
          width: `${frac * 100}%`,
          background: msLeft < 5_000 ? "var(--color-loss)" : "var(--color-win)",
          transition: "width 250ms linear, background 300ms",
        }}
      />
    </span>
  );
}

function Seat({
  s,
  spot,
  isMe,
  myCards,
  acting,
  msLeft,
  isButton,
  winner,
  handId,
  showdown,
}: {
  s: PokerSeatDTO;
  spot: { x: number; y: number };
  isMe: boolean;
  myCards: Card[] | null;
  acting: boolean;
  msLeft: number | null;
  isButton: boolean;
  winner: boolean;
  handId: string | null;
  showdown: boolean;
}) {
  const p = s.player;
  const cards: Array<Card | null> | null = isMe && myCards && s.inHand && !s.folded ? myCards : s.shown ? s.shown : s.holding ? Array(s.holding).fill(null) : null;
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
      style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
    >
      {/* Cards sit above the plate (below it for the top seats so they stay on the felt). */}
      <div className={cn("flex h-[clamp(40px,9cqh,78px)] items-end", spot.y < 30 && "order-last items-start")}>
        <AnimatePresence>
          {cards &&
            cards.map((c, i) => (
              <motion.div
                // One key per card slot per hand: a face-down card turns over in place at showdown.
                key={`${handId}-${i}`}
                initial={{ opacity: 0, y: -10, scale: 0.85 }}
                animate={{ opacity: s.folded ? 0.25 : 1, y: 0, scale: 1, rotate: (i - 0.5) * 6 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.35, delay: i * 0.08 }}
                className={i > 0 ? "-ml-[clamp(14px,3cqh,26px)]" : undefined}
              >
                <PlayingCard card={c} i={0} className="!h-[clamp(40px,9cqh,78px)]" />
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
      <div className="relative">
        <motion.div
          animate={
            winner
              ? { scale: [1, 1.08, 1], boxShadow: "0 0 0 2px var(--color-win), 0 0 28px rgba(61,220,132,0.45)" }
              : acting
                ? { scale: 1.04, boxShadow: "0 0 0 1.5px rgba(255,255,255,0.7)" }
                : { scale: 1, boxShadow: "0 0 0 0px rgba(0,0,0,0)" }
          }
          transition={{ duration: winner ? 0.6 : 0.25 }}
          className={cn(
            "relative flex min-w-[clamp(84px,17cqw,128px)] flex-col items-center rounded-[12px] bg-elevated/95 px-2.5 pb-2 pt-1.5 hairline",
            s.folded && "opacity-50",
            isMe && "ring-1 ring-fg/40",
          )}
        >
          {p ? (
            <>
              <span className="flex max-w-[120px] items-center gap-1 truncate text-[12px] font-medium">
                {p.kind === "bot" && <span className="text-[10px] text-fg-disabled" aria-label="bot">●</span>}
                <span className="truncate">{isMe ? "You" : p.name}</span>
              </span>
              <span className="text-[13px] font-semibold tabular">{p.stack > 0 || !s.allIn ? fmt(p.stack) : "All in"}</span>
              {s.handName && <span className="max-w-[140px] truncate text-[10px] font-medium text-fg-muted">{s.handName}</span>}
            </>
          ) : s.reservedFor ? (
            <span className="text-[12px] text-fg-muted">{s.reservedFor.name} sitting…</span>
          ) : (
            <span className="text-[12px] text-fg-disabled">Empty</span>
          )}
          {acting && msLeft !== null && <TurnTimer msLeft={msLeft} totalMs={20_000} />}
        </motion.div>
        {isButton && (
          <motion.span
            layoutId="dealer-button"
            className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-fg text-[10px] font-bold text-bg shadow"
            transition={{ type: "spring", stiffness: 200, damping: 22 }}
          >
            D
          </motion.span>
        )}
        <AnimatePresence>
          {s.lastAction && !showdown && (
            <motion.span
              key={`${s.lastAction.kind}-${s.lastAction.amount}`}
              initial={{ opacity: 0, y: 6, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              className={cn(
                "absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
                s.lastAction.kind === "fold" ? "bg-elevated text-fg-muted" : s.lastAction.kind === "allin" ? "bg-loss text-fg" : "bg-fg text-bg",
              )}
            >
              {ACTION_LABEL[s.lastAction.kind]}
            </motion.span>
          )}
          {winner && s.won !== null && s.won > 0 && (
            <motion.span
              key="won"
              initial={{ opacity: 0, y: 10, scale: 0.6 }}
              animate={{ opacity: 1, y: -4, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 16 }}
              className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-win px-2.5 py-0.5 text-[12px] font-bold text-bg"
            >
              +{fmt(s.won)}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function PokerTable({
  table,
  mySeat,
  myCards,
  offsetMs,
}: {
  table: PokerTableDTO;
  mySeat: number | null;
  myCards: Card[] | null;
  offsetMs: number;
}) {
  const h = table.hand;
  const msLeft = useCountdown(h?.deadline ?? null, offsetMs);
  // Turn the table so your seat is always at the bottom.
  const base = mySeat ?? 0;
  const spotOf = (seat: number) => SPOTS[(seat - base + POKER_SEATS) % POKER_SEATS]!;
  const bets = table.seats.reduce((s, x) => s + x.bet, 0);
  const pot = (h?.pot ?? 0) + bets;
  const winners = new Set(h?.winners.map((w) => w.seat) ?? []);
  const showdown = h?.street === "showdown";

  return (
    <div className="relative h-full min-h-[340px] w-full overflow-hidden">
      {/* The felt */}
      <div
        aria-hidden
        className="absolute inset-x-[7%] inset-y-[15%] rounded-[999px]"
        style={{
          background: "radial-gradient(ellipse at 50% 40%, #1f7a4a 0%, #13573a 55%, #0c3a27 100%)",
          boxShadow: "inset 0 0 0 10px #2a1d12, inset 0 0 0 12px rgba(255,255,255,0.06), inset 0 10px 40px rgba(0,0,0,0.45), 0 18px 50px rgba(0,0,0,0.45)",
        }}
      />

      {/* Board and pot */}
      <div className="absolute left-1/2 top-[46%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <AnimatePresence mode="popLayout">
          {pot > 0 && (
            <motion.div
              key="pot"
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="rounded-full bg-black/35 px-3 py-1 text-[13px] font-semibold tabular text-fg"
            >
              Pot {fmt(pot)}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex h-[clamp(56px,13cqh,110px)] gap-1.5">
          <AnimatePresence>
            {(h?.board ?? []).map((c, i) => (
              <motion.div
                key={`${h!.id}-${c}`}
                // The flop turns over one card after another; turn and river land on their own.
                initial={{ opacity: 0, y: -40, rotateY: 180 }}
                animate={{ opacity: 1, y: 0, rotateY: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.45, delay: i < 3 ? i * 0.18 : 0, ease: [0.16, 1, 0.3, 1] }}
              >
                <PlayingCard card={c} i={0} className="!h-[clamp(56px,13cqh,110px)]" />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {showdown && h!.winners.length > 0 && (
            <motion.p
              key={`w-${h!.id}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-[60cqw] text-center text-[13px] font-semibold text-fg"
            >
              {h!.winners
                .map((w) => `${w.seat === mySeat ? "You" : (table.seats[w.seat]?.player?.name ?? "Seat " + (w.seat + 1))} win${w.seat === mySeat ? "" : "s"} ${fmt(w.amount)}${w.handName ? ` · ${w.handName}` : ""}`)
                .join(" · ")}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Bets in front of each seat */}
      {table.seats.map((s) => {
        if (!s.bet) return null;
        const p = toward(spotOf(s.seat), 0.55);
        return (
          <motion.div
            key={`bet-${s.seat}`}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[12px] font-semibold tabular"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <span aria-hidden className="size-2.5 rounded-full bg-[#f5c542] ring-1 ring-black/40" />
            {fmt(s.bet)}
          </motion.div>
        );
      })}

      {table.seats.map((s) => (
        <Seat
          key={s.seat}
          s={s}
          spot={spotOf(s.seat)}
          isMe={s.seat === mySeat}
          myCards={s.seat === mySeat ? myCards : null}
          acting={h?.toAct === s.seat}
          msLeft={h?.toAct === s.seat && s.player?.kind === "human" ? msLeft : null}
          isButton={h?.button === s.seat}
          winner={showdown && winners.has(s.seat)}
          handId={h?.id ?? null}
          showdown={showdown}
        />
      ))}
    </div>
  );
}
