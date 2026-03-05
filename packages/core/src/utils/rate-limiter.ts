interface QueueItem {
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export class RateLimiter {
  private queue: QueueItem[] = [];
  private processing = false;
  private lastCallTime = 0;

  constructor(
    private minIntervalMs: number = 1000,
    private maxRetries: number = 3,
    private baseBackoffMs: number = 1000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      if (!this.processing) {
        void this.processQueue();
      }
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      const now = Date.now();
      const elapsed = now - this.lastCallTime;
      if (elapsed < this.minIntervalMs) {
        await this.sleep(this.minIntervalMs - elapsed);
      }
      this.lastCallTime = Date.now();
      let attempt = 0;
      let success = false;
      while (attempt <= this.maxRetries && !success) {
        try {
          const result = await item.fn();
          item.resolve(result);
          success = true;
        } catch (err) {
          attempt++;
          if (attempt > this.maxRetries) {
            item.reject(err);
          } else {
            const backoff = this.baseBackoffMs * Math.pow(2, attempt - 1);
            await this.sleep(backoff);
          }
        }
      }
    }
    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
