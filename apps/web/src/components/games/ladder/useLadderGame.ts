"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INSTANT_BET_LIMITS, type LadderGame, type LadderRoundDTO, type LadderUpdateDTO } from "@snakeland/shared";
import { ApiError } from "@/lib/api";
import { ladderApi } from "@/lib/arcade-api";
import { recordRound } from "@/lib/session-stats";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { useChipSlip } from "../shared/ChipSlip";
import type { RecentItem } from "../shared/RecentMultipliers";
import { useClientSeed } from "../shared/useClientSeed";

function message(e: unknown) {
  if (e instanceof ApiError) return e.code === "INSUFFICIENT_FUNDS" ? "Not enough chips for that." : e.message;
  return "Something went wrong. Try again.";
}

/** Round state and actions shared by Tower and Crossing. */
export function useLadderGame(game: LadderGame) {
  const { me, setWallet } = useSession();
  const { play, haptic } = useSettings();
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
        if (u.round.status === "bust") haptic("lose");
        else play("chime");
      }
    },
    [game, setWallet, play, haptic],
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

  const step = (door?: number) =>
    run(async () => {
      if (!round || round.status !== "playing") return;
      const u = await api.step(round.id, round.version, door);
      if (u.round.status === "playing") play("flip");
      apply(u);
    });

  const cashOut = () =>
    run(async () => {
      if (!round || round.status !== "playing" || round.level === 0) return;
      apply(await api.cashOut(round.id, round.version));
    });

  return { slip, balance, round, nextCommit, pending, error, setError, recent, start, step, cashOut, clientSeed, lastClientSeed };
}
