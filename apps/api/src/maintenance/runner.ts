import type { Leadership } from "../realtime/leader";
import type { PushService } from "../push/service";
import type { PurgeService } from "./purge";

const EVERY_MS = 10 * 60_000;

/**
 * Background housekeeping on one instance (the Redis lease holder): the purge
 * and push notifications. Runs every 10 minutes; each step is idempotent.
 */
export class MaintenanceRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly purge: PurgeService,
    private readonly leadership: Leadership,
    private readonly log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void },
    private readonly push: PushService | null = null,
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
      const rows = await this.purge.purgeOldGameData(now);
      const guests = await this.purge.purgeInactiveGuests(now);
      const daily = (await this.push?.notifyDaily(now)) ?? 0;
      const titles = (await this.push?.notifyTitles(now)) ?? 0;
      if (guests || daily || titles || Object.keys(rows).length) this.log.info({ guests, rows, push: { daily, titles } }, "maintenance");
    } catch (err) {
      this.log.error({ err }, "maintenance failed");
    } finally {
      this.running = false;
    }
  }
}
