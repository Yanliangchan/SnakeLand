/**
 * A timer that only runs while there is work. `run` returns false when the
 * loop can sleep; `wake()` restarts it. While asleep it costs nothing: no
 * timers, no Redis or Postgres traffic.
 */
export class IdleLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly intervalMs: number,
    private readonly run: () => Promise<boolean>,
  ) {}

  get awake() {
    return this.timer !== null;
  }

  wake() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.step(), this.intervalMs);
    void this.step();
  }

  private async step() {
    if (this.running) return;
    this.running = true;
    try {
      const keepGoing = await this.run();
      if (!keepGoing) this.sleep();
    } finally {
      this.running = false;
    }
  }

  sleep() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stop() {
    this.stopped = true;
    this.sleep();
  }
}
