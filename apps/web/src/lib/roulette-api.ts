"use client";

import { useEffect, useRef, useState } from "react";
import type {
  RouletteMyBetsDTO,
  RouletteServerMessage,
  RouletteSettlementDTO,
  RouletteWheelDTO,
  WheelId,
} from "@snakeland/shared";
import { rouletteRoom } from "@snakeland/shared";
import { api } from "./api";
import { useLiveSocket } from "./live-socket";

export const rouletteApi = {
  state: (wheelId: WheelId) =>
    api<{ wheel: RouletteWheelDTO; myBets: RouletteMyBetsDTO | null; serverNow: string }>("/v1/roulette/state", {
      method: "POST",
      body: { wheelId },
    }),
  place: (input: { wheelId: WheelId; roundId: string; tableId: string; bets: Array<{ betId: string; amount: number }> }) =>
    api<{ myBets: RouletteMyBetsDTO; balance: number }>("/v1/roulette/bets", { method: "POST", body: input }),
  clear: (input: { wheelId: WheelId; roundId: string }) =>
    api<{ myBets: RouletteMyBetsDTO; balance: number }>("/v1/roulette/bets/clear", { method: "POST", body: input }),
};

/** Live wheel feed over the shared live socket; switching wheels just re-joins. */
export function useRouletteSocket(
  wheelId: WheelId,
  handlers: { onSettled: (s: RouletteSettlementDTO) => void; onState?: (w: RouletteWheelDTO) => void },
) {
  const [wheel, setWheel] = useState<RouletteWheelDTO | null>(null);
  const wheelRef = useRef(wheelId);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
    wheelRef.current = wheelId;
  });

  const { connected, offsetMs } = useLiveSocket(rouletteRoom(wheelId), (raw) => {
    const msg = raw as unknown as RouletteServerMessage;
    if (msg.type === "state") {
      if (msg.wheel.wheelId === wheelRef.current) {
        setWheel(msg.wheel);
        handlersRef.current.onState?.(msg.wheel);
      }
    } else if (msg.type === "activity") {
      setWheel((w) =>
        w && w.wheelId === msg.wheelId && w.round?.id === msg.roundId
          ? { ...w, players: msg.players, totalStaked: msg.totalStaked }
          : w,
      );
    } else if (msg.type === "settled") {
      handlersRef.current.onSettled(msg.settlement);
    }
  });

  return { wheel: wheel?.wheelId === wheelId ? wheel : null, connected, offsetMs };
}
