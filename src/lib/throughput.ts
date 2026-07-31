/** Exponentially-smoothed bytes/sec estimate from a stream of progress
 * updates, so the displayed speed doesn't jitter with every single
 * DataChannel message. */
export class ThroughputTracker {
  private lastBytes = 0;
  private lastTime = performance.now();
  private ema = 0;
  private readonly alpha = 0.3;
  private readonly minIntervalMs = 150;

  /** Feed the current cumulative byte count in; returns the current smoothed bytes/sec. */
  update(bytes: number): number {
    const now = performance.now();
    const dtMs = now - this.lastTime;
    if (dtMs >= this.minIntervalMs) {
      const instantaneous = ((bytes - this.lastBytes) / dtMs) * 1000;
      this.ema = this.ema === 0 ? instantaneous : this.ema * (1 - this.alpha) + instantaneous * this.alpha;
      this.lastBytes = bytes;
      this.lastTime = now;
    }
    return Math.max(0, this.ema);
  }
}
