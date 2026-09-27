"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INSTANT_BET_LIMITS, type HiloChoice, type LadderGame, type LadderRoundDTO, type LadderUpdateDTO } from "@snakeland/shared";
import { ApiError } from "@/lib/api";
import { ladderApi } from "@/lib/arcade-api";
import { recordRound } from "@/lib/session-stats";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { useChipSlip } from "../shared/ChipSlip";
import type { RecentItem } from "../shared/RecentMultipliers";
import { useClientSeed } from "../shared/useClientSeed";

export interface AutoConfig {
  /** null = until stopped. */
  rounds: number | null;
  /** Cash out after this many safe steps. */
  steps: number;
  stopProfit: number | null;
  stopLoss: number | null;
}

export interface AutoProgress {
  played: number;
  total: number | null;
  profit: number;
  running: boolean;
}

function message(e: unknown) {
  if (e instanceof ApiError) return e.code === "INSUFFICIENT_FUNDS" ? "Not enough chips for that." : e.message;
  return "Something went wrong. Try again.";
}

/** Round state and actions shared by the ladder games. */
export function useLadderGame(game: LadderGame) {
  const { me, setWallet } = useSession();
  const { play } = useSettings();
  const clientSeed = useClientSeed();
  const api = useMemo(() => ladderApi(game), [game]);
  const balance = me?.wallet.balance ?? 0;
  const slip = useChipSlip(Math.min(INSTANT_BET_LIMITS.max, balance));
  const [round, setRound] = useState<LadderRoundDTO | null>(null);
  const [nextCommit, setNextCommit] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [lastClientSeed, setLastClientSeed] = useState<string | null>(null);
  const busy = useRef(false);
  const setSlip = slip.set;

  // Resume a round left in play (refresh, another tab).
  useEffect(() => {
    let cancelled = false;
    api
      .state()
      .then((s) => {
        if (cancelled) return;
        setRound(s.round);
        setNextCommit(s.nextCommit);
        if (s.round) setSlip(s.round.bet);
      })
      .catch(() => !cancelled && setError("Couldn't load the game"));
    return () => {
      cancelled = true;
    };
  }, [api, setSlip]);

  const apply = useCallback(
    (u: LadderUpdateDTO) => {
      setRound(u.round);
      setNextCommit(u.nextCommit);
      if (u.balance !== null) setWallet({ balance: u.balance });
      if (u.round.status !== "playing") {
        recordRound(game, u.round.bet, u.round.payout ?? 0);
        setRecent((r) => [{ id: u.round.id, x100: u.round.status === "bust" ? 0 : u.round.multiplierX100 }, ...r].slice(0, 12));
        play(u.round.status === "bust" ? "lose" : "coin");
      }
    },
    [game, setWallet, play],
  );

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        if (e instanceof ApiError && (e.code === "STALE_VERSION" || e.code === "ROUND_SETTLED")) {
          const s = await api.state();
          setRound(s.round);
          setNextCommit(s.nextCommit);
        } else setError(message(e));
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [api],
  );

  const start = (mode: string) =>
    run(async () => {
      if (slip.amount < INSTANT_BET_LIMITS.min) return setError(`Minimum bet is ${INSTANT_BET_LIMITS.min}.`);
      const seed = clientSeed.next();
      setLastClientSeed(seed);
      apply(await api.start({ bet: slip.amount, mode, clientSeed: seed }));
      play("click");
    });

  // ---------------------------------------------------------------- auto bet
  const [auto, setAuto] = useState<AutoProgress | null>(null);
  const stopAuto = useRef(false);
  const { speed } = useSettings();

  /**
   * Play rounds on repeat: bet, take `steps` steps (picking with `pick`), cash
   * out, and go again until the round count or a stop condition is reached.
   * Stopping mid-round finishes that round (cashing out if anything is won).
   */
  const startAuto = async (cfg: AutoConfig, mode: string, pick: (r: LadderRoundDTO) => number | HiloChoice | undefined) => {
    if (busy.current || round?.status === "playing") return;
    const bet = slip.amount;
    if (bet < INSTANT_BET_LIMITS.min) return setError(`Minimum bet is ${INSTANT_BET_LIMITS.min}.`);
    busy.current = true;
    stopAuto.current = false;
    setPending(true);
    setError(null);
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms * speed));
    let progress: AutoProgress = { played: 0, total: cfg.rounds, profit: 0, running: true };
    setAuto(progress);
    try {
      while (!stopAuto.current && (cfg.rounds === null || progress.played < cfg.rounds)) {
        const seed = clientSeed.next();
        setLastClientSeed(seed);
        let u = await api.start({ bet, mode, clientSeed: seed });
        apply(u);
        while (u.round.status === "playing" && u.round.level < cfg.steps && !stopAuto.current) {
          await pause(320);
          u = await api.step(u.round.id, u.round.version, pick(u.round));
          if (u.round.status === "playing") play("pop");
          apply(u);
        }
        if (u.round.status === "playing" && u.round.level > 0) {
          u = await api.cashOut(u.round.id, u.round.version);
          apply(u);
        }
        if (u.round.status === "playing") break; // stopped before the first step: leave it to the player
        progress = { ...progress, played: progress.played + 1, profit: progress.profit + (u.round.payout ?? 0) - u.round.bet };
        setAuto(progress);
        if (cfg.stopProfit !== null && progress.profit >= cfg.stopProfit) break;
        if (cfg.stopLoss !== null && -progress.profit >= cfg.stopLoss) break;
        await pause(500);
      }
    } catch (e) {
      setError(message(e));
      const s = await api.state().catch(() => null);
      if (s) {
        setRound(s.round);
        setNextCommit(s.nextCommit);
      }
    } finally {
      busy.current = false;
      setPending(false);
      setAuto({ ...progress, running: false });
    }
  };

  const step = (move?: number | HiloChoice) =>
    run(async () => {
      if (!round || round.status !== "playing") return;
      const u = await api.step(round.id, round.version, move);
      if (u.round.status === "playing") play("pop");
      apply(u);
    });

  const cashOut = () =>
    run(async () => {
      if (!round || round.status !== "playing" || round.level === 0) return;
      apply(await api.cashOut(round.id, round.version));
    });

  return {
    slip,
    balance,
    round,
    nextCommit,
    pending,
    error,
    setError,
    recent,
    start,
    step,
    cashOut,
    clientSeed,
    lastClientSeed,
    auto,
    startAuto,
    stopAuto: () => {
      stopAuto.current = true;
    },
  };
}
