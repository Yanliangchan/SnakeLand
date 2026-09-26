"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveRoom } from "@snakeland/shared";
import { api } from "./api";
import { WS_URL } from "./config";

/** Close the socket after this long in a background tab, so idle games can sleep server-side. */
const HIDDEN_GRACE_MS = 60_000;

type Message = { type: string; serverNow?: string } & Record<string, unknown>;

/**
 * The live-game WebSocket. One socket per page, sitting in one room;
 * changing `room` just re-joins. Reconnects with backoff, tracks the server
 * clock offset (so countdowns follow server deadlines), and lets go of the
 * connection while the tab is hidden for a while.
 */
export function useLiveSocket(room: LiveRoom, onMessage: (msg: Message) => void) {
  const [connected, setConnected] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const offsetMs = useRef(0);
  const socket = useRef<WebSocket | null>(null);
  const roomRef = useRef(room);
  const handler = useRef(onMessage);

  useEffect(() => {
    handler.current = onMessage;
  });

  useEffect(() => {
    roomRef.current = room;
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "join", room }));
  }, [room]);

  useEffect(() => {
    let stopped = false;
    let paused = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let pinger: ReturnType<typeof setInterval> | undefined;

    const schedule = () => {
      if (stopped || paused) return;
      retry = Math.min(retry + 1, 5);
      timer = setTimeout(() => void connect(), 500 * 2 ** retry);
    };

    const connect = async () => {
      if (stopped || paused) return;
      // A fresh single-use ticket per connection (fetched same-origin with the session cookie).
      let ticket: string;
      try {
        ticket = (await api<{ ticket: string }>("/v1/live/ws-ticket", { method: "POST", body: {} })).ticket;
      } catch {
        schedule();
        return;
      }
      if (stopped || paused) return;
      const ws = new WebSocket(`${WS_URL}/v1/live/ws?ticket=${encodeURIComponent(ticket)}`);
      socket.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "join", room: roomRef.current }));
        pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 20_000);
      };
      ws.onmessage = (event) => {
        let msg: Message;
        try {
          msg = JSON.parse(String(event.data)) as Message;
        } catch {
          return;
        }
        if (typeof msg.serverNow === "string") offsetMs.current = new Date(msg.serverNow).getTime() - Date.now();
        handler.current(msg);
      };
      ws.onclose = () => {
        clearInterval(pinger);
        setConnected(false);
        if (socket.current === ws) socket.current = null;
        schedule();
      };
    };

    const onVisibility = () => {
      clearTimeout(hiddenTimer);
      if (document.visibilityState === "hidden") {
        hiddenTimer = setTimeout(() => {
          paused = true;
          setAsleep(true);
          clearTimeout(timer);
          socket.current?.close();
        }, HIDDEN_GRACE_MS);
      } else if (paused) {
        paused = false;
        setAsleep(false);
        retry = 0;
        void connect();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(hiddenTimer);
      clearInterval(pinger);
      document.removeEventListener("visibilitychange", onVisibility);
      socket.current?.close();
    };
  }, []);

  return { connected, asleep, offsetMs };
}
