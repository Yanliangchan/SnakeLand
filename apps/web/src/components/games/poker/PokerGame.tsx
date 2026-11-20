"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  POKER_TABLES,
  pokerBuyIn,
  pokerLegal,
  pokerRoom,
  verifyCommit,
  type PokerActionKind,
  type PokerLobbyDTO,
  type PokerTableId,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";
import { pokerApi, usePokerTable } from "@/lib/poker-api";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { FairnessDialog, FairRow, VerifiedBadge } from "../shared/FairnessDialog";
import { PokerTable } from "./PokerTable";

const LiveChat = dynamic(() => import("../shared/LiveChat").then((m) => m.LiveChat), { ssr: false });

const fmt = (n: number) => n.toLocaleString();

function message(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "INSUFFICIENT_FUNDS") return "Not enough chips in your wallet for that buy-in.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export function PokerGame() {
  const { me: session, setWallet, refresh } = useSession();
  const { play } = useSettings();
  const balance = session?.wallet.balance ?? 0;

  const [tableId, setTableId] = useState<PokerTableId>("low");
  const [lobby, setLobby] = useState<PokerLobbyDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fairOpen, setFairOpen] = useState(false);
  const [lastNote, setLastNote] = useState<string | null>(null);

  const { table, me, setMe, connected, offsetMs } = usePokerTable(tableId, {
    onCashout: (amount, bal) => {
      setWallet({ balance: bal });
      setLastNote(amount > 0 ? `${fmt(amount)} chips back in your wallet` : "You left the table");
      play("coin");
    },
  });

  // Open the table you're already sitting at.
  useEffect(() => {
    let cancelled = false;
    pokerApi
      .lobby()
      .then((l) => {
        if (cancelled) return;
        setLobby(l);
        if (l.seatedAt) setTableId(l.seatedAt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const seatedHere = me?.seat !== null && me?.seat !== undefined;
  const waiting = me?.reservedSeat !== null && me?.reservedSeat !== undefined;
  const seatedElsewhere = !!lobby?.seatedAt && lobby.seatedAt !== tableId && !seatedHere && !waiting;
  const range = pokerBuyIn(tableId);
  const cfg = POKER_TABLES.find((t) => t.id === tableId)!;
  // The buy-in slider starts at 50 big blinds for each table.
  const [buyInChoice, setBuyInChoice] = useState<{ table: PokerTableId; amount: number } | null>(null);
  const buyIn = buyInChoice?.table === tableId ? buyInChoice.amount : Math.min(range.max, Math.max(range.min, 50 * cfg.bb));
  const setBuyIn = (amount: number) => setBuyInChoice({ table: tableId, amount });

  const leaving = seatedHere && !!table?.seats[me!.seat!]?.player?.leaving;
  // Once you've asked to leave the dealer folds for you; no more decisions.
  const legal = table && seatedHere && !leaving ? pokerLegal(table, me!.seat!) : null;
  const myTurn = !!legal;
  const h = table?.hand ?? null;
  const pot = (h?.pot ?? 0) + (table?.seats.reduce((s, x) => s + x.bet, 0) ?? 0);
  const raiseMin = legal?.raise?.min ?? 0;
  const raiseMax = legal?.raise?.max ?? 0;
  // Each new decision starts the raise slider at the minimum.
  const decision = `${h?.id}-${h?.street}-${h?.toAct}-${raiseMin}`;
  const [raiseChoice, setRaiseChoice] = useState<{ key: string; to: number } | null>(null);
  const raiseTo = raiseChoice?.key === decision ? raiseChoice.to : raiseMin;
  const setRaiseTo = (to: number) => setRaiseChoice({ key: decision, to });

  // Sounds: cards hitting the felt, your turn, and winning a pot.
  const prev = useRef<{ board: number; turn: boolean; hand: string | null; won: boolean }>({ board: 0, turn: false, hand: null, won: false });
  useEffect(() => {
    const board = h?.board.length ?? 0;
    const won = !!h && h.street === "showdown" && h.winners.some((w) => w.seat === me?.seat);
    const p = prev.current;
    if (h?.id !== p.hand) play("whoosh");
    else if (board > p.board) play("flip");
    if (myTurn && !p.turn) play("tick");
    if (won && !p.won) play("win");
    prev.current = { board, turn: myTurn, hand: h?.id ?? null, won };
  }, [h, myTurn, me?.seat, play]);

  async function run(fn: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }

  const sit = () =>
    run(async () => {
      const res = await pokerApi.sit(tableId, buyIn);
      setMe(res.me);
      setLastNote(null);
      play("chip");
      await refresh();
      setLobby((l) => (l ? { ...l, seatedAt: tableId } : l));
    });

  const leave = () =>
    run(async () => {
      const res = await pokerApi.leave();
      if (res.me) setMe(res.me);
      setLastNote(res.pending ? "You'll stand up when this hand ends." : null);
      if (!res.pending) setLobby((l) => (l ? { ...l, seatedAt: null } : l));
    });

  const act = (kind: PokerActionKind, to?: number) =>
    run(async () => {
      await pokerApi.act(tableId, kind, to);
      play(kind === "fold" ? "click" : "chip");
    });

  // Keyboard: F fold, C check/call, R raise, A all-in.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (!legal || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      const k = e.key.toLowerCase();
      if (k === "f") void act("fold");
      else if (k === "c") void act(legal.canCheck ? "check" : "call");
      else if (k === "r" && legal.raise) void act(h?.currentBet ? "raise" : "bet", raiseTo);
      else if (k === "a" && legal.raise) void act("allin");
      else return;
      e.preventDefault();
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const presets = useMemo(() => {
    if (!legal?.raise || !h) return [];
    const myBet = table!.seats[me!.seat!]!.bet;
    const toCall = h.currentBet - myBet;
    // Pot-sized raises measure the pot after calling.
    const size = (frac: number) => Math.round(h.currentBet + (pot + toCall) * frac);
    const clamp = (n: number) => Math.min(raiseMax, Math.max(raiseMin, n));
    return [
      { label: "½ pot", to: clamp(size(0.5)) },
      { label: "¾ pot", to: clamp(size(0.75)) },
      { label: "Pot", to: clamp(size(1)) },
    ];
  }, [legal, h, pot, raiseMin, raiseMax, table, me]);

  const myStack = seatedHere ? (table?.seats[me!.seat!]?.player?.stack ?? 0) : 0;

  const controls = (
    <div className="flex flex-col gap-4">
      <PanelSection label="Table">
        <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Poker tables">
          {POKER_TABLES.map((t) => {
            const info = lobby?.tables.find((x) => x.id === t.id);
            const active = t.id === tableId;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if ((seatedHere || waiting) && !active) {
                    setError("Leave this table before switching.");
                    return;
                  }
                  setError(null);
                  setTableId(t.id);
                }}
                className={cn(
                  "flex flex-col items-center rounded-[var(--radius-ui)] px-2 py-2 text-[12px] transition-colors hairline",
                  active ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                )}
              >
                <span className="font-semibold tabular">
                  {fmt(t.sb)}/{fmt(t.bb)}
                </span>
                <span className={cn("text-[11px]", active ? "text-bg/70" : "text-fg-disabled")}>
                  {active && table ? `${table.players} playing` : info ? `${info.players} playing` : t.name}
                </span>
              </button>
            );
          })}
        </div>
      </PanelSection>

      <AnimatePresence mode="wait">
        {myTurn && legal ? (
          <motion.div key="act" {...fadeUp} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => act("fold")} disabled={pending}>
                Fold <kbd className="hidden text-[10px] opacity-50 lg:inline">F</kbd>
              </Button>
              <Button variant="secondary" onClick={() => act(legal.canCheck ? "check" : "call")} disabled={pending}>
                {legal.canCheck ? "Check" : `Call ${fmt(legal.callAmount)}`} <kbd className="hidden text-[10px] opacity-50 lg:inline">C</kbd>
              </Button>
            </div>
            {legal.raise && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-ui)] p-3 hairline">
                <div className="flex items-center justify-between text-[12px] text-fg-muted">
                  <span>{h?.currentBet ? "Raise to" : "Bet"}</span>
                  <span className="text-[16px] font-semibold text-fg tabular">{fmt(raiseTo)}</span>
                </div>
                <input
                  type="range"
                  min={raiseMin}
                  max={raiseMax}
                  step={table!.bb >= 100 ? table!.bb / 2 : 1}
                  value={Math.min(raiseMax, Math.max(raiseMin, raiseTo))}
                  onChange={(e) => setRaiseTo(Number(e.target.value))}
                  aria-label="Raise amount"
                  className="w-full accent-[var(--color-win)]"
                />
                <div className="grid grid-cols-4 gap-1.5">
                  {presets.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => setRaiseTo(p.to)}
                      className="rounded-[8px] py-1.5 text-[12px] text-fg-muted transition-colors hairline hover:text-fg"
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setRaiseTo(raiseMax)}
                    className="rounded-[8px] py-1.5 text-[12px] font-semibold text-loss transition-colors hairline hover:text-fg"
                  >
                    All in
                  </button>
                </div>
                <Button onClick={() => act(raiseTo >= raiseMax ? "allin" : h?.currentBet ? "raise" : "bet", raiseTo)} disabled={pending}>
                  {raiseTo >= raiseMax ? `All in ${fmt(raiseMax)}` : `${h?.currentBet ? "Raise to" : "Bet"} ${fmt(raiseTo)}`}{" "}
                  <kbd className="hidden text-[10px] opacity-50 lg:inline">R</kbd>
                </Button>
              </div>
            )}
          </motion.div>
        ) : seatedHere || waiting ? (
          <motion.div key="seated" {...fadeUp} className="flex flex-col gap-3">
            <div className="flex items-end justify-between">
              <PanelSection label={waiting ? "Waiting for a seat" : "Your stack"}>
                <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular">{fmt(waiting ? buyIn : myStack)}</span>
              </PanelSection>
              <Button variant="secondary" size="sm" onClick={leave} disabled={pending || !!table?.seats[me?.seat ?? -1]?.player?.leaving}>
                {table?.seats[me?.seat ?? -1]?.player?.leaving ? "Leaving after hand" : waiting ? "Cancel" : "Leave table"}
              </Button>
            </div>
            <p className="text-[12px] text-fg-muted">
              {waiting
                ? "A bot is finishing this hand. You take its seat next hand."
                : h && h.street !== "showdown" && h.toAct !== null
                  ? `Waiting for ${table!.seats[h.toAct]?.player?.name ?? "the next player"}…`
                  : "Next hand coming up…"}
            </p>
          </motion.div>
        ) : (
          <motion.div key="buyin" {...fadeUp} className="flex flex-col gap-3">
            <PanelSection label="Buy in">
              <div className="flex items-baseline justify-between">
                <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular">{fmt(buyIn)}</span>
                <span className="text-[12px] text-fg-muted tabular">
                  {fmt(range.min)} – {fmt(range.max)}
                </span>
              </div>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={cfg.bb}
                value={buyIn}
                onChange={(e) => setBuyIn(Number(e.target.value))}
                aria-label="Buy-in amount"
                className="mt-2 w-full accent-[var(--color-win)]"
              />
            </PanelSection>
            <Button onClick={sit} disabled={pending || seatedElsewhere || buyIn > balance} loading={pending}>
              {seatedElsewhere ? "You're seated at another table" : buyIn > balance ? "Not enough chips" : `Sit down with ${fmt(buyIn)}`}
            </Button>
            <p className="text-[12px] leading-relaxed text-fg-muted">
              Your buy-in leaves your wallet and comes back (with whatever you win) when you stand up. Empty seats are filled by bots; take
              one and the bot leaves after the hand.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(error || lastNote) && (
          <motion.p key={error ?? lastNote} {...fadeUp} role={error ? "alert" : "status"} className={cn("text-center text-[13px]", error ? "text-loss" : "text-fg-muted")}>
            {error ?? lastNote}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between text-[12px] text-fg-muted">
        <span className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", connected ? "bg-win" : "bg-fg-disabled")} aria-hidden />
          {table ? `${table.players} ${table.players === 1 ? "player" : "players"} · blinds ${fmt(table.sb)}/${fmt(table.bb)}` : "Connecting…"}
        </span>
        <button onClick={() => setFairOpen(true)} className="rounded-full px-3 py-1 transition-colors hairline hover:text-fg">
          Fair
        </button>
      </div>
      <p className="hidden text-[11px] leading-relaxed text-fg-disabled lg:block">
        2.5% rake (max 3 big blinds) only on pots won against another real player after the flop. Bots play from the house bank.
      </p>
    </div>
  );

  return (
    <>
      <GameShell
        game="poker"
        title="Poker"
        headerExtra={<LiveChat room={pokerRoom(tableId)} />}
        tableId={tableId}
        tableLabel={`${cfg.name} · ${fmt(cfg.sb)}/${fmt(cfg.bb)}`}
        controls={controls}
      >
        {table ? (
          <PokerTable table={table} mySeat={seatedHere ? me!.seat : null} myCards={me?.cards ?? null} offsetMs={offsetMs.current} />
        ) : (
          <div className="grid h-full place-items-center text-[13px] text-fg-muted">Finding your table…</div>
        )}
      </GameShell>
      <FairnessDialog
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        intro="Every hand's deck is shuffled from a server seed whose hash is shown before the deal, with the hand's id as the client seed. The seed is revealed when the hand ends, so you can rebuild the exact deck."
      >
        {h && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium">Hand #{h.number}</p>
            <FairRow label="Commit (sha256)" value={h.commit} />
            <FairRow label="Hand id (client seed)" value={h.id} />
            {h.seed ? (
              <>
                <FairRow label="Server seed" value={h.seed} />
                <VerifiedBadge ok={verifyCommit(h.seed, h.commit)} label="Commit verified" />
              </>
            ) : (
              <p className="text-[12px] text-fg-muted">The seed is revealed when this hand ends.</p>
            )}
          </div>
        )}
      </FairnessDialog>
    </>
  );
}
