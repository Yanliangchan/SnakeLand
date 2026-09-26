"use client";

import { useEffect, useRef, useState } from "react";
import {
  CRASH_ROOM,
  type CrashBetPublicDTO,
  type CrashMyBetDTO,
  type CrashServerMessage,
  type CrashSettlementDTO,
  type CrashStateDTO,
} from "@snakeland/shared";
import { api } from "./api";
import { useLiveSocket } from "./live-socket";

type BetResult = { myBet: CrashMyBetDTO | null; balance: number };

export const crashApi = {
  state: () => api<{ state: CrashStateDTO; myBet: CrashMyBetDTO | null; serverNow: string }>("/v1/crash/state", { method: "POST", body: {} }),
  bet: (input: { roundId: string; amount: number; autoCashoutX100: number | null }) =>
    api<BetResult>("/v1/crash/bet", { method: "POST", body: input }),
  cancel: (roundId: string) => api<BetResult>("/v1/crash/cancel", { method: "POST", body: { roundId } }),
  cashout: (roundId: string) => api<BetResult>("/v1/crash/cashout", { method: "POST", body: { roundId } }),
};

/** Live crash feed: round state, who's in, and your own results. */
export function useCrashSocket(handlers: {
  onSettled: (s: CrashSettlementDTO) => void;
  onAutoCashout: (myBet: CrashMyBetDTO, balance: number) => void;
  /** A fresh round snapshot arrived (new round, takeoff, crash). */
  onState?: (state: CrashStateDTO) => void;
}) {
  const [state, setState] = useState<CrashStateDTO | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const { connected, offsetMs } = useLiveSocket(CRASH_ROOM, (raw) => {
    const msg = raw as unknown as CrashServerMessage;
    if (msg.type === "crash-state") {
      setState(msg.state);
      handlersRef.current.onState?.(msg.state);
    }
    else if (msg.type === "crash-bets") {
      setState((s) =>
        s && s.round?.id === msg.roundId
          ? { ...s, bets: mergeMine(s.bets, msg.bets), players: msg.players, totalStaked: msg.totalStaked }
          : s,
      );
    } else if (msg.type === "crash-settled") handlersRef.current.onSettled(msg.settlement);
    else if (msg.type === "crash-cashout") handlersRef.current.onAutoCashout(msg.myBet, msg.balance);
  });

  return { state, setState, connected, offsetMs };
}

/** Broadcast lists don't know who "me" is; keep the flag from the personal snapshot. */
function mergeMine(prev: CrashBetPublicDTO[], next: CrashBetPublicDTO[]) {
  const mine = prev.find((b) => b.isMe);
  if (!mine) return next;
  let marked = false;
  return next.map((b) => {
    if (!marked && b.name === mine.name && b.amount === mine.amount) {
      marked = true;
      return { ...b, isMe: true };
    }
    return b;
  });
}
