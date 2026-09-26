"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BLACKJACK_RULES,
  type BlackjackAction,
  type BlackjackRoundDTO,
  type BlackjackTableDTO,
  type BlackjackUpdateDTO,
  type RevealedShoeDTO,
} from "@snakeland/shared";
import { GameShell } from "@/components/GameShell";
import { CHIP_VALUES, type ChipValue } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { blackjackApi, newClientSeed } from "@/lib/blackjack-api";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { BetControls, type Mode } from "./BetControls";
import { chipId, chipsFor, MAX_STACK, sum, type SlipChip } from "./chips";
import { FairnessPanel } from "./FairnessPanel";
import { Felt } from "./Felt";

const maxSeq = (r: BlackjackRoundDTO | null) =>
  r ? Math.max(-1, ...r.hands.flatMap((h) => h.cards.map((c) => c.seq)), ...r.dealer.cards.map((c) => c.seq)) : -1;

/** The stake a round was opened with (hands may since be doubled). */
const baseBetOf = (r: BlackjackRoundDTO) => Math.min(...r.hands.map((h) => (h.doubled ? h.bet / 2 : h.bet)));

const freshTray = () => Object.fromEntries(CHIP_VALUES.map((v) => [v, chipId(v)])) as Record<ChipValue, string>;

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "INSUFFICIENT_FUNDS") return "Not enough chips for that.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export function BlackjackGame() {
  const { me, setWallet } = useSession();
  const { play } = useSettings();

  const [table, setTable] = useState<BlackjackTableDTO | null>(null);
  const [round, setRound] = useState<BlackjackRoundDTO | null>(null);
  const [baseSeq, setBaseSeq] = useState(0);
  const [revealed, setRevealed] = useState<RevealedShoeDTO | null>(null);
  const [chips, setChips] = useState<SlipChip[]>([]);
  const [tray, setTray] = useState(freshTray);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fairOpen, setFairOpen] = useState(false);
  const busy = useRef(false);

  const balance = me?.wallet.balance ?? 0;
  const bet = sum(chips);
  const room = Math.max(0, Math.min(BLACKJACK_RULES.maxBet, balance) - bet);

  const mode: Mode = !table
    ? "loading"
    : !round
      ? "bet"
      : round.phase === "insurance"
        ? "insurance"
        : round.phase === "player"
          ? "play"
          : "settled";

  const loadTable = useCallback(async () => {
    const t = await blackjackApi.table();
    setTable(t);
    setRound(t.round);
    setBaseSeq(0);
    if (t.round) setChips(chipsFor(baseBetOf(t.round)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    blackjackApi
      .table()
      .then((t) => {
        if (cancelled) return;
        setTable(t);
        setRound(t.round);
        if (t.round) setChips(chipsFor(baseBetOf(t.round)));
      })
      .catch((e: unknown) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  function apply(u: BlackjackUpdateDTO, isNewRound: boolean) {
    setBaseSeq(isNewRound ? 0 : maxSeq(round) + 1);
    setRound(u.round);
    setTable((t) => (t ? { ...t, shoe: u.shoe, recent: u.recent, streak: u.streak } : t));
    if (u.balance !== null) setWallet({ balance: u.balance });
    if (u.revealedShoe) setRevealed(u.revealedShoe);
    if (maxSeq(u.round) > (isNewRound ? -1 : maxSeq(round))) play("flip");
  }

  async function run(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // The hand moved on elsewhere (another tab, a retry): resync from the server.
      if (e instanceof ApiError && (e.code === "STALE_VERSION" || e.code === "ROUND_SETTLED")) await loadTable();
      else setError(message(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function placeChip(value: ChipValue) {
    if (value > room || pending) return;
    play("click");
    setError(null);
    setChips((c) => {
      const next = [...c, { id: tray[value], value }];
      return next.length > MAX_STACK ? chipsFor(sum(next)) : next;
    });
    setTray((t) => ({ ...t, [value]: chipId(value) }));
  }

  const deal = () =>
    run(async () => {
      if (!table || bet < BLACKJACK_RULES.minBet) return;
      const u = await blackjackApi.deal({
        tableId: table.id,
        bet,
        clientSeed: table.shoe.clientSeed ? undefined : newClientSeed(),
      });
      apply(u, true);
    });

  const act = (action: BlackjackAction) =>
    run(async () => {
      if (!round || !round.allowed.includes(action)) return;
      apply(await blackjackApi.act(round.id, action, round.version), false);
    });

  const nextTable = () =>
    run(async () => {
      if (round && round.phase !== "settled") {
        setError("Finish your hand before changing tables.");
        return;
      }
      const n = await blackjackApi.nextTable();
      setTable(n.table);
      setRound(null);
      setBaseSeq(0);
      if (n.revealedShoe) setRevealed(n.revealedShoe);
    });

  // Keyboard: H/S/D/P to play, I/N for insurance, Enter to deal.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || fairOpen) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      const map: Record<string, BlackjackAction> = { h: "hit", s: "stand", d: "double", p: "split", i: "insurance", n: "no_insurance" };
      if ((mode === "play" || mode === "insurance") && map[k]) {
        e.preventDefault();
        void act(map[k]);
      } else if ((mode === "bet" || mode === "settled") && e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void deal();
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      <GameShell
        title="Blackjack"
        tableId={table?.id ?? "loading"}
        tableLabel={table ? `Table ${table.id.slice(0, 4).toUpperCase()}` : undefined}
        onNextTable={nextTable}
        controls={
          <BetControls
            mode={mode}
            round={round}
            tray={tray}
            bet={bet}
            room={room}
            pending={pending}
            error={error}
            onChip={placeChip}
            onClear={() => setChips([])}
            onDeal={deal}
            onAction={act}
            onChangeBet={() => {
              setRound(null);
              setError(null);
            }}
          />
        }
      >
        {table ? (
          <Felt
            round={round}
            baseSeq={baseSeq}
            shoe={table.shoe}
            recent={table.recent}
            streak={table.streak}
            chips={chips}
            onFairness={() => setFairOpen(true)}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="min-h-[460px] rounded-[var(--radius-card)] bg-surface hairline sm:min-h-[520px]"
          />
        )}
      </GameShell>
      {table && (
        <FairnessPanel open={fairOpen} onClose={() => setFairOpen(false)} shoe={table.shoe} revealed={revealed} />
      )}
    </>
  );
}
