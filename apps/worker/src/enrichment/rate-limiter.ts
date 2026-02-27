function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ProviderRateLimiter {
  private activeCount = 0;
  private readonly waitQueue: Array<() => void> = [];
  private nextAllowedAt = 0;
  private readonly minIntervalMs: number;

  constructor(
    private readonly rpm: number,
    private readonly concurrency: number,
  ) {
    const safeRpm = Number.isFinite(rpm) && rpm > 0 ? rpm : 60;
    this.minIntervalMs = Math.ceil(60_000 / safeRpm);
  }

  async schedule<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireSlot();

    try {
      const waitMs = Math.max(0, this.nextAllowedAt - Date.now());
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      this.nextAllowedAt = Date.now() + this.minIntervalMs;
      return await operation();
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });

    this.activeCount += 1;
  }

  private releaseSlot(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }
}
