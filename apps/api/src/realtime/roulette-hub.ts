import type { WebSocket } from "ws";
import { z } from "zod";
import { ROULETTE_WHEELS, type WheelId } from "@snakeland/shared";
import type { RouletteBusMessage, RouletteService } from "../games/roulette/service";
import type { Bus } from "./bus";

const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), wheelId: z.enum(ROULETTE_WHEELS.map((w) => w.id) as [WheelId, ...WheelId[]]) }),
  z.object({ type: z.literal("ping") }),
]);

const MAX_SOCKETS_PER_USER = 5;
const MSG_BUDGET = 30; // messages per window
const MSG_WINDOW_MS = 10_000;
const HEARTBEAT_MS = 25_000;

interface Client {
  socket: WebSocket;
  userId: string;
  wheelId: WheelId | null;
  alive: boolean;
  budget: number;
  windowStart: number;
}

/**
 * This instance's WebSocket connections. Receives bus messages (from any
 * instance) and routes them: wheel events to sockets watching that wheel,
 * user events to that user's sockets.
 */
export class RouletteHub {
  private clients = new Set<Client>();
  private readonly unsubscribe: () => void;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    bus: Bus,
    private readonly roulette: RouletteService,
  ) {
    this.unsubscribe = bus.subscribe((m) => this.route(m as RouletteBusMessage));
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private send(c: Client, message: unknown) {
    if (c.socket.readyState !== c.socket.OPEN) return;
    const withClock =
      message && typeof message === "object" && (message as { type?: string }).type === "state"
        ? { ...(message as object), serverNow: new Date().toISOString() }
        : message;
    c.socket.send(JSON.stringify(withClock));
  }

  private route(m: RouletteBusMessage) {
    for (const c of this.clients) {
      if (m.kind === "wheel" && c.wheelId === m.wheelId) this.send(c, m.message);
      else if (m.kind === "user" && c.userId === m.userId) this.send(c, m.message);
    }
  }

  private beat() {
    for (const c of this.clients) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
    }
  }

  attach(socket: WebSocket, userId: string) {
    const mine = [...this.clients].filter((c) => c.userId === userId);
    if (mine.length >= MAX_SOCKETS_PER_USER) {
      socket.close(1008, "Too many connections");
      return;
    }
    const client: Client = { socket, userId, wheelId: null, alive: true, budget: MSG_BUDGET, windowStart: Date.now() };
    this.clients.add(client);

    socket.on("pong", () => (client.alive = true));
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => socket.terminate());
    socket.on("message", (raw, isBinary) => {
      const now = Date.now();
      if (now - client.windowStart > MSG_WINDOW_MS) {
        client.windowStart = now;
        client.budget = MSG_BUDGET;
      }
      if (--client.budget < 0) {
        socket.close(1008, "Slow down");
        return;
      }
      if (isBinary) return;
      let parsed: z.infer<typeof ClientMessage>;
      try {
        parsed = ClientMessage.parse(JSON.parse(raw.toString()));
      } catch {
        this.send(client, { type: "error", message: "Bad message" });
        return;
      }
      if (parsed.type === "ping") {
        this.send(client, { type: "pong", serverNow: new Date().toISOString() });
        return;
      }
      client.wheelId = parsed.wheelId;
      void this.roulette
        .wheelState(parsed.wheelId)
        .then((wheel) => client.wheelId === parsed.wheelId && this.send(client, { type: "state", wheel }))
        .catch(() => this.send(client, { type: "error", message: "Couldn't load the wheel" }));
    });
  }

  async close() {
    clearInterval(this.heartbeat);
    this.unsubscribe();
    for (const c of this.clients) c.socket.close(1001, "Server shutting down");
    this.clients.clear();
  }
}
