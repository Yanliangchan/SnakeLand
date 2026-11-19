"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BLACKJACK_RULES,
  handValue,
  type Card,
  type BlackjackAction,
  type BlackjackRoundDTO,
  type BlackjackTableDTO,
  type BlackjackUpdateDTO,
  type RecentResult,
  type RevealedShoeDTO,
} from "@snakeland/shared";
import { GameShell } from "@/components/GameShell";
import { ApiError } from "@/lib/api";
import { blackjackApi } from "@/lib/blackjack-api";
import { recordRound } from "@/lib/session-stats";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { BetControls, type Mode } from "./BetControls";
import { FairnessPanel } from "./FairnessPanel";
import { Felt } from "./Felt";
import { DEAL_STAGGER } from "./HandView";
import { useChipSlip } from "../shared/ChipSlip";
import { useClientSeed } from "../shared/useClientSeed";

const maxSeq = (r: BlackjackRoundDTO | null) =>
  r ? Math.max(-1, ...r.hands.flatMap((h) => h.cards.map((c) => c.seq)), ...r.dealer.cards.map((c) => c.seq)) : -1;

/** The stake a round was opened with (hands may since be doubled). */
const baseBetOf = (r: BlackjackRoundDTO) => Math.min(...r.hands.map((h) => (h.doubled ? h.bet / 2 : h.bet)));

/**
 * The dealer's play, staged. The server has already settled the hand; this
 * only replays it: step 0 shows the hole card face-down, step 1 turns it over,
 * and each later step draws one more dealer card. Results stay hidden until the end.
 */
interface Reveal {
  round: BlackjackRoundDTO;
  step: number;
  /** Seconds before the hole card turns (longer after a fresh deal, so the deal lands first). */
  firstDelay: number;
  /** Applied once the dealer is done, so nothing gives the result away early. */
  done: { balance: number | null; recent: RecentResult[]; streak: number; record: boolean };
}

const lastRevealStep = (r: BlackjackRoundDTO) => r.dealer.cards.length - 1;

function revealView(r: BlackjackRoundDTO, step: number): BlackjackRoundDTO {
  const cards = r.dealer.cards
    .slice(0, Math.max(2, step + 1))
    .map((c, idx) => (idx === 1 && step === 0 ? { ...c, code: null } : c));
  const { total, soft } = handValue(cards.flatMap((c): Card[] => (c.code ? [c.code] : [])));
  return {
    ...r,
    dealer: { cards, total, soft, revealed: step > 0 },
    hands: r.hands.map((h) => ({ ...h, result: null, payout: null })),
    totalPayout: null,
  };
}

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "INSUFFICIENT_FUNDS") return "Not enough chips for that.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export function BlackjackGame() {
  const { me, setWallet } = useSession();
  const { play, speed, reducedMotion } = useSettings();

  const [table, setTable] = useState<BlackjackTableDTO | null>(null);
  const [round, setRound] = useState<BlackjackRoundDTO | null>(null);
  const [baseSeq, setBaseSeq] = useState(0);
  const [revealed, setRevealed] = useState<RevealedShoeDTO | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fairOpen, setFairOpen] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const busy = useRef(false);

  const balance = me?.wallet.balance ?? 0;
  const slip = useChipSlip(Math.min(BLACKJACK_RULES.maxBet, balance));
  const bet = slip.amount;
  const clientSeed = useClientSeed();
  const setSlip = slip.set;

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
    if (t.round) setSlip(baseBetOf(t.round));
  }, [setSlip]);

  useEffect(() => {
    let cancelled = false;
    blackjackApi
      .table()
      .then((t) => {
        if (cancelled) return;
        setTable(t);
        setRound(t.round);
        if (t.round) setSlip(baseBetOf(t.round));
      })
      .catch((e: unknown) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, [setSlip]);

  function apply(u: BlackjackUpdateDTO, isNewRound: boolean) {
    const justSettled = u.round.phase === "settled" && (isNewRound || round?.phase !== "settled");
    // The dealer turns the hole card over in this update: play it out slowly.
    const dealerTurn = u.round.dealer.revealed && (isNewRound || !round?.dealer.revealed) && !reducedMotion;
    if (justSettled && !dealerTurn) recordRound("blackjack", u.round.totalBet, u.round.totalPayout ?? 0);
    setBaseSeq(isNewRound ? 0 : maxSeq(round) + 1);
    setRound(u.round);
    if (dealerTurn) {
      // A fresh deal lands four cards first; after a stand, just a beat.
      const firstDelay = isNewRound ? 3 * DEAL_STAGGER + 1.1 : 0.7;
      setTable((t) => (t ? { ...t, shoe: u.shoe } : t));
      setReveal({
        round: u.round,
        step: 0,
        firstDelay,
        done: { balance: u.balance, recent: u.recent, streak: u.streak, record: justSettled },
      });
    } else {
      setTable((t) => (t ? { ...t, shoe: u.shoe, recent: u.recent, streak: u.streak } : t));
      if (u.balance !== null) setWallet({ balance: u.balance });
    }
    if (u.revealedShoe) setRevealed(u.revealedShoe);
    if (maxSeq(u.round) > (isNewRound ? -1 : maxSeq(round))) play("flip");
  }

  const finishReveal = useCallback(
    ({ round: r, done }: Reveal) => {
      if (done.record) recordRound("blackjack", r.totalBet, r.totalPayout ?? 0);
      if (done.balance !== null) setWallet({ balance: done.balance });
    },
    [setWallet],
  );

  // Step through the dealer's reveal, one beat at a time.
  useEffect(() => {
    if (!reveal) return;
    const last = lastRevealStep(reveal.round);
    const total = revealView(reveal.round, reveal.step).dealer.total;
    // Linger a little longer when the dealer is on a total that could go either way.
    const tense = reveal.step > 0 && total >= 12 && total <= 16;
    const wait = reveal.step === 0 ? reveal.firstDelay : reveal.step >= last ? 0.8 : 1.05 + (tense ? 0.35 : 0);
    const timer = setTimeout(() => {
      if (reveal.step >= last) {
        setReveal(null);
        setTable((t) => (t ? { ...t, recent: reveal.done.recent, streak: reveal.done.streak } : t));
        finishReveal(reveal);
      } else {
        play("flip");
        setReveal({ ...reveal, step: reveal.step + 1 });
      }
    }, wait * speed * 1000);
    return () => clearTimeout(timer);
  }, [reveal, speed, play, finishReveal]);

  // Leaving mid-reveal still lands the balance and the session stats.
  const pendingReveal = useRef<Reveal | null>(null);
  useEffect(() => {
    pendingReveal.current = reveal;
  }, [reveal]);
  useEffect(
    () => () => {
      if (pendingReveal.current) finishReveal(pendingReveal.current);
    },
    [finishReveal],
  );

  const revealing = reveal !== null;
  const shownRound = reveal ? revealView(reveal.round, reveal.step) : round;

  async function run(fn: () => Promise<void>) {
    if (busy.current || revealing) return;
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

  const deal = () =>
    run(async () => {
      if (!table || bet < BLACKJACK_RULES.minBet) return;
      const u = await blackjackApi.deal({
        tableId: table.id,
        bet,
        clientSeed: table.shoe.clientSeed ? undefined : clientSeed.next(),
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
        game="blackjack"
        title="Blackjack"
        tableId={table?.id ?? "loading"}
        tableLabel={table ? `Table ${table.id.slice(0, 4).toUpperCase()}` : undefined}
        onNextTable={nextTable}
        controls={
          <BetControls
            mode={mode}
            round={shownRound}
            slip={slip}
            pending={pending || revealing}
            error={error}
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
            round={shownRound}
            revealing={revealing}
            baseSeq={baseSeq}
            dealerBaseSeq={reveal && reveal.step > 0 ? Number.MAX_SAFE_INTEGER : baseSeq}
            shoe={table.shoe}
            recent={table.recent}
            streak={table.streak}
            chips={slip.chips}
            onFairness={() => setFairOpen(true)}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="h-full"
          />
        )}
      </GameShell>
      {table && (
        <FairnessPanel open={fairOpen} onClose={() => setFairOpen(false)} shoe={table.shoe} revealed={revealed} />
      )}
    </>
  );
}
