"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  BACCARAT_RULES,
  verifyCommit,
  type BaccaratBet,
  type BaccaratRoundDTO,
  type BaccaratTableDTO,
  type RevealedShoeDTO,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { baccaratApi } from "@/lib/baccarat-api";
import { fadeUp } from "@/lib/motion";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { FairnessDialog, FairRow, VerifiedBadge } from "../shared/FairnessDialog";
import { ChipSelector, useSpotChips } from "../shared/SpotChips";
import { useClientSeed } from "../shared/useClientSeed";
import { BaccaratFelt } from "./BaccaratFelt";

function message(e: unknown) {
  if (e instanceof ApiError) return e.code === "INSUFFICIENT_FUNDS" ? "Not enough chips for that." : e.message;
  return "Something went wrong. Try again.";
}

export function BaccaratGame() {
  const { me, setWallet } = useSession();
  const { play } = useSettings();
  const clientSeed = useClientSeed();
  const balance = me?.wallet.balance ?? 0;
  const spots = useSpotChips<BaccaratBet>(Math.min(BACCARAT_RULES.maxTotal, balance));

  const [table, setTable] = useState<BaccaratTableDTO | null>(null);
  const [round, setRound] = useState<BaccaratRoundDTO | null>(null);
  const [revealed, setRevealed] = useState<RevealedShoeDTO | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fairOpen, setFairOpen] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    baccaratApi
      .table()
      .then((t) => !cancelled && setTable(t))
      .catch((e: unknown) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const placeOn = (spot: BaccaratBet) => {
    // Tapping the felt after a hand starts a fresh layout for the next one.
    if (round) setRound(null);
    setError(null);
    if (spots.place(spot) === null) setError(`Bets are capped at ${Math.min(BACCARAT_RULES.maxTotal, balance).toLocaleString()} per hand.`);
  };

  const deal = () =>
    run(async () => {
      if (!table) return;
      const bets = spots.amounts();
      const tooSmall = Object.values(bets).some((v) => (v ?? 0) < BACCARAT_RULES.minBet);
      if (spots.total === 0) return setError("Place a bet first.");
      if (tooSmall) return setError(`Each bet must be at least ${BACCARAT_RULES.minBet}.`);
      setRound(null);
      const u = await baccaratApi.play({
        tableId: table.id,
        bets,
        clientSeed: table.shoe.clientSeed ? undefined : clientSeed.next(),
      });
      play("flip");
      setRound(u.round);
      setTable(u.table);
      setWallet({ balance: u.balance });
      if (u.revealedShoe) setRevealed(u.revealedShoe);
    });

  const nextTable = () =>
    run(async () => {
      const n = await baccaratApi.nextTable();
      setTable(n.table);
      setRound(null);
      if (n.revealedShoe) setRevealed(n.revealedShoe);
    });

  // Enter deals.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void deal();
      }
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  return (
    <>
      <GameShell
        title="Baccarat"
        tableId={table?.id ?? "loading"}
        tableLabel={table ? `Table ${table.id.slice(0, 4).toUpperCase()}` : undefined}
        onNextTable={nextTable}
        controls={
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {error && (
                <motion.p {...fadeUp} role="alert" className="text-center text-[13px] text-loss">
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="flex flex-col gap-4 @4xl:flex-row @4xl:items-end @4xl:gap-6">
              <PanelSection label="Chip value" className="@4xl:min-w-72 @4xl:flex-1">
                <ChipSelector state={spots} disabled={pending} />
              </PanelSection>
              <PanelSection label="Total bet">
                <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular">{spots.total.toLocaleString()}</span>
              </PanelSection>
              <div className="grid grid-cols-[auto_1fr] gap-2 @4xl:w-64">
                <Button
                  size="lg"
                  variant="secondary"
                  disabled={pending || spots.total === 0}
                  onClick={() => {
                    spots.clear();
                    setRound(null);
                  }}
                >
                  Clear
                </Button>
                <Button size="lg" onClick={deal} loading={pending} disabled={!table || spots.total === 0}>
                  {round ? "Deal again" : "Deal"}
                </Button>
              </div>
            </div>
          </div>
        }
      >
        {table ? (
          <BaccaratFelt table={table} round={round} spots={spots} canBet={!pending} onSpot={placeOn} onFairness={() => setFairOpen(true)} />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="h-full" />
        )}
      </GameShell>
      {table && (
        <FairnessDialog
          open={fairOpen}
          onClose={() => setFairOpen(false)}
          intro="Each 8-deck shoe is shuffled from a server seed committed before the first card, mixed with your browser's seed. The seed is revealed when the shoe is retired or you leave the table."
        >
          <section className="flex flex-col gap-3">
            <p className="text-[13px] font-medium">Current shoe</p>
            <FairRow label="Server seed hash (commit)" value={table.shoe.commit} />
            <FairRow label="Client seed" value={table.shoe.clientSeed} placeholder="Set on the first deal of this shoe" />
          </section>
          {revealed && (
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium">Previous shoe</p>
                <VerifiedBadge ok={verifyCommit(revealed.serverSeed, revealed.commit)} label="Commit verified" />
              </div>
              <FairRow label="Server seed" value={revealed.serverSeed} />
              <FairRow label="Client seed" value={revealed.clientSeed} />
            </section>
          )}
        </FairnessDialog>
      )}
    </>
  );
}
