export type KnownService =
  | 'angel_one'
  | 'nse'
  | 'screener'
  | 'news'
  | 'gemini'
  | 'perplexity'
  | 'chartink'
  | 'sheet';

export class ApiTracker {
  private sessionCounts: Map<string, number> = new Map();

  track(service: string): void {
    const current = this.sessionCounts.get(service) ?? 0;
    this.sessionCounts.set(service, current + 1);
  }

  getSessionCounts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of this.sessionCounts) {
      result[key] = value;
    }
    return result;
  }

  getCount(service: string): number {
    return this.sessionCounts.get(service) ?? 0;
  }

  reset(): void {
    this.sessionCounts.clear();
  }
}
