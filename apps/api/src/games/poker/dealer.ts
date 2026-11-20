import { POKER_TABLES, pokerRoom, type PokerTableId } from "@snakeland/shared";
import type { Bus } from "../../realtime/bus";
import { IdleLoop } from "../../realtime/idle-loop";
import type { Leadership } from "../../realtime/leader";
import type { LiveBusMessage } from "../../realtime/messages";
import type { Presence, RoomCounts } from "../../realtime/presence";
import type { PokerService } from "./service";

const TICK_MS = 250;
const PRESENCE_REFRESH_MS = 2_000;

/** Nothing to do for this table before `until` (ms), or until someone sits or watches (`idle`). */
type Wait = { until: number } | { idle: true };

/**
 * Runs the poker tables' clocks: bot moves, timeouts, streets and new hands.
 * One instance leads (state is in Postgres, so another takes over cleanly).
 * Each table's next deadline is remembered so the database is only touched
 * when something is due; a table with nobody seated and nobody watching
 * sleeps, and the loop stops entirely when every table sleeps. Sitting,
 * leaving, acting or opening a table publishes "wake" for it.
 */
export class PokerDealer {
  private ticking = false;
  private wasLeader = false;
  private waits = new Map<PokerTableId, Wait>();
  private viewers: RoomCounts | null = null;
  private viewersAt = 0;
  private readonly unsubscribe: () => void;
  private readonly loop = new IdleLoop(TICK_MS, () => this.tick());
  private started = false;

  constructor(
    private readonly poker: PokerService,
    bus: Bus,
    private readonly leadership: Leadership,
    private readonly presence: Presence,
    private readonly log: { error: (obj: unknown, msg?: string) => void } = console,
  ) {
    this.unsubscribe = bus.subscribe((m) => {
      const msg = m as LiveBusMessage;
      const table = msg.kind === "wake" ? POKER_TABLES.find((t) => pokerRoom(t.id) === msg.room) : undefined;
      if (!table) return;
      this.waits.delete(table.id);
      this.viewersAt = 0;
      if (this.started) this.loop.wake();
    });
  }

  start() {
    this.started = true;
    this.loop.wake();
  }

  get awake() {
    return this.loop.awake;
  }

  async stop() {
    this.loop.stop();
    this.unsubscribe();
    await this.leadership.release();
  }

  private async viewerCounts(): Promise<RoomCounts> {
    if (!this.viewers || Date.now() - this.viewersAt >= PRESENCE_REFRESH_MS) {
      this.viewers = await this.presence.totals();
      this.viewersAt = Date.now();
    }
    return this.viewers;
  }

  /** Advance every table that's due. Returns false once there's nothing left to do. */
  async tick(now = new Date()): Promise<boolean> {
    if (this.ticking) return true;
    this.ticking = true;
    try {
      const leader = await this.leadership.isLeader();
      if (leader !== this.wasLeader) this.waits.clear();
      this.wasLeader = leader;
      const viewers = await this.viewerCounts();
      const watched = (id: PokerTableId) => (viewers[pokerRoom(id)] ?? 0) > 0;
      if (!leader) return POKER_TABLES.some((t) => watched(t.id));

      for (const table of POKER_TABLES) {
        const wait = this.waits.get(table.id);
        if (wait && "until" in wait && now.getTime() < wait.until) continue;
        if (wait && "idle" in wait && !watched(table.id)) continue;
        this.waits.delete(table.id);
        try {
          const { nextAt } = await this.poker.step(table.id, watched(table.id), now);
          this.waits.set(table.id, nextAt ? { until: nextAt.getTime() } : { idle: true });
        } catch (err) {
          this.log.error({ err, table: table.id }, "poker tick failed");
          // Back off a little rather than hammering a broken table.
          this.waits.set(table.id, { until: now.getTime() + 2_000 });
        }
      }
      const allAsleep = POKER_TABLES.every((t) => {
        const w = this.waits.get(t.id);
        return w !== undefined && "idle" in w && !watched(t.id);
      });
      return !allAsleep;
    } finally {
      this.ticking = false;
    }
  }
}
