import type { Leadership } from "../realtime/leader";
import type { ProgressService } from "../progress/service";
import type { PurgeService } from "./purge";

const EVERY_MS = 10 * 60_000;

/**
 * Background housekeeping on one instance (the Redis lease holder): the daily
 * top-5 snapshot and the purge. Runs every 10 minutes; each step is idempotent.
 */
export class MaintenanceRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly progress: ProgressService,
    private readonly purge: PurgeService,
    private readonly leadership: Leadership,
    private readonly log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void },
  ) {}

  start() {
    if (this.timer) return;
    const first = setTimeout(() => void this.run(), 30_000);
    first.unref();
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.leadership.release();
  }

  async run(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.leadership.isLeader())) return;
      const snapshot = await this.progress.snapshotTop5(now);
      const rows = await this.purge.purgeOldGameData(now);
      const guests = await this.purge.purgeInactiveGuests(now);
      if (snapshot || guests || Object.keys(rows).length) this.log.info({ snapshot, guests, rows }, "maintenance");
    } catch (err) {
      this.log.error({ err }, "maintenance failed");
    } finally {
      this.running = false;
    }
  }
}
