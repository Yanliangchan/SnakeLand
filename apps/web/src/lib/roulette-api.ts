"use client";

import { useEffect, useRef, useState } from "react";
import type {
  RouletteMyBetsDTO,
  RouletteServerMessage,
  RouletteSettlementDTO,
  RouletteWheelDTO,
  WheelId,
} from "@snakeland/shared";
import { api } from "./api";
import { API_URL } from "./config";

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

/**
 * Live wheel feed. One socket per page; switching wheels just re-joins.
 * Reconnects with backoff, and tracks the server clock offset so countdowns
 * match the server's deadlines rather than this device's clock.
 */
export function useRouletteSocket(
  wheelId: WheelId,
  handlers: { onSettled: (s: RouletteSettlementDTO) => void; onState?: (w: RouletteWheelDTO) => void },
) {
  const [wheel, setWheel] = useState<RouletteWheelDTO | null>(null);
  const [connected, setConnected] = useState(false);
  const offsetMs = useRef(0);
  const socket = useRef<WebSocket | null>(null);
  const wheelRef = useRef(wheelId);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    wheelRef.current = wheelId;
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "join", wheelId }));
  }, [wheelId]);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pinger: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/v1/roulette/ws`);
      socket.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "join", wheelId: wheelRef.current }));
        pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 20_000);
      };
      ws.onmessage = (event) => {
        let msg: RouletteServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as RouletteServerMessage;
        } catch {
          return;
        }
        if (msg.type === "state") {
          offsetMs.current = new Date(msg.serverNow).getTime() - Date.now();
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
      };
      ws.onclose = () => {
        clearInterval(pinger);
        setConnected(false);
        if (stopped) return;
        retry = Math.min(retry + 1, 5);
        timer = setTimeout(connect, 500 * 2 ** retry);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(pinger);
      socket.current?.close();
    };
  }, []);

  return { wheel: wheel?.wheelId === wheelId ? wheel : null, connected, offsetMs };
}
