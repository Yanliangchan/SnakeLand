"use client";

import { useEffect, useRef, useState } from "react";
import {
  pokerRoom,
  type PokerActionKind,
  type PokerLobbyDTO,
  type PokerMeDTO,
  type PokerPush,
  type PokerTableDTO,
  type PokerTableId,
} from "@snakeland/shared";
import { api } from "./api";
import { useLiveSocket } from "./live-socket";

export const pokerApi = {
  lobby: () => api<PokerLobbyDTO>("/v1/poker/lobby"),
  view: (tableId: PokerTableId) =>
    api<{ table: PokerTableDTO; me: PokerMeDTO }>("/v1/poker/view", { method: "POST", body: { tableId } }),
  sit: (tableId: PokerTableId, buyIn: number) =>
    api<{ me: PokerMeDTO }>("/v1/poker/sit", { method: "POST", body: { tableId, buyIn } }),
  leave: () => api<{ me: PokerMeDTO | null; pending: boolean }>("/v1/poker/leave", { method: "POST", body: {} }),
  act: (tableId: PokerTableId, action: PokerActionKind, to?: number) =>
    api<{ me: PokerMeDTO }>("/v1/poker/act", { method: "POST", body: { tableId, action, to } }),
};

type Snapshot = { type: "poker-state"; table: PokerTableDTO; me?: PokerMeDTO };

/**
 * One poker table over the shared live socket: the public table for
 * everyone, plus this player's own seat and cards (sent only to them).
 */
export function usePokerTable(tableId: PokerTableId, handlers: { onCashout?: (amount: number, balance: number) => void } = {}) {
  const [table, setTable] = useState<PokerTableDTO | null>(null);
  const [me, setMe] = useState<PokerMeDTO | null>(null);
  const tableRef = useRef(tableId);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    tableRef.current = tableId;
    handlersRef.current = handlers;
  });

  const { connected, offsetMs } = useLiveSocket(pokerRoom(tableId), (raw) => {
    const msg = raw as unknown as PokerPush | Snapshot;
    if (msg.type === "poker-state") {
      if (msg.table.id !== tableRef.current) return;
      // Ignore a stale broadcast that arrives after a newer one.
      setTable((prev) => (prev && prev.id === msg.table.id && prev.version > msg.table.version ? prev : msg.table));
      if ("me" in msg && msg.me) setMe(msg.me);
    } else if (msg.type === "poker-me") {
      if (msg.me.tableId === tableRef.current) setMe(msg.me);
    } else if (msg.type === "poker-cashout") {
      handlersRef.current.onCashout?.(msg.amount, msg.balance);
    }
  });

  return {
    table: table?.id === tableId ? table : null,
    me: me?.tableId === tableId ? me : null,
    setMe,
    connected,
    offsetMs,
  };
}
