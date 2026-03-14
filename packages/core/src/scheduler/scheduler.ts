export interface SchedulerConfig {
  eveningTime: string;
  morningTime: string;
  syncIntervalMinutes: number;
  nseHolidays: string[];
}

export interface SchedulerCallbacks {
  onEvening(): Promise<void>;
  onMorning(): Promise<void>;
  onSync(): Promise<void>;
}

interface LastRunState {
  eveningDate: string | null;
  morningDate: string | null;
  syncTime: number;
}

export class TradingScheduler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastRun: LastRunState = {
    eveningDate: null,
    morningDate: null,
    syncTime: 0,
  };

  constructor(private config: SchedulerConfig) {
    this.warnIfHolidaysMissing();
  }

  start(callbacks: SchedulerCallbacks): void {
    if (this.intervalHandle !== null) return;

    // Tick every 60 seconds
    this.intervalHandle = setInterval(() => {
      void this.tick(callbacks);
    }, 60_000);

    // Also tick immediately
    void this.tick(callbacks);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  isTradingDay(date: Date): boolean {
    const ist = this.getISTComponents(date);
    const dayOfWeek = new Date(`${ist.date}T12:00:00+05:30`).getDay();

    // Weekend check (0=Sunday, 6=Saturday)
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;

    // NSE holiday check
    if (this.config.nseHolidays.includes(ist.date)) return false;

    return true;
  }

  private async tick(callbacks: SchedulerCallbacks): Promise<void> {
    const now = new Date();
    const ist = this.getISTComponents(now);

    if (!this.isTradingDay(now)) return;

    // Evening callback (5-min window to absorb tick drift)
    if (this.isInWindow(ist.time, this.config.eveningTime) && this.lastRun.eveningDate !== ist.date) {
      this.lastRun.eveningDate = ist.date;
      try {
        await callbacks.onEvening();
      } catch (err) {
        process.stderr.write(`[scheduler] evening error: ${(err as Error).message}\n`);
      }
    }

    // Morning callback (5-min window to absorb tick drift)
    if (this.isInWindow(ist.time, this.config.morningTime) && this.lastRun.morningDate !== ist.date) {
      this.lastRun.morningDate = ist.date;
      try {
        await callbacks.onMorning();
      } catch (err) {
        process.stderr.write(`[scheduler] morning error: ${(err as Error).message}\n`);
      }
    }

    // Sync callback — only during market hours (9:15-15:30 IST) at configured interval
    const syncIntervalMs = this.config.syncIntervalMinutes * 60_000;
    const inMarketHours = this.isInMarketHours(ist.time);
    if (inMarketHours && Date.now() - this.lastRun.syncTime >= syncIntervalMs) {
      this.lastRun.syncTime = Date.now();
      try {
        await callbacks.onSync();
      } catch (err) {
        process.stderr.write(`[scheduler] sync error: ${(err as Error).message}\n`);
      }
    }
  }

  private isInMarketHours(time: string): boolean {
    return time >= '09:15' && time <= '15:30';
  }

  /** Check if current time is within a 5-minute window of the target (absorbs tick drift). */
  private isInWindow(current: string, target: string): boolean {
    const [tH, tM] = target.split(':').map(Number);
    const [cH, cM] = current.split(':').map(Number);
    const targetMin = tH * 60 + tM;
    const currentMin = cH * 60 + cM;
    return currentMin >= targetMin && currentMin < targetMin + 5;
  }

  private getISTComponents(date: Date): { date: string; time: string } {
    const formatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';

    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = get('hour').padStart(2, '0');
    const minute = get('minute').padStart(2, '0');

    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`,
    };
  }

  private warnIfHolidaysMissing(): void {
    const currentYear = new Date().getFullYear();
    const hasCurrentYear = this.config.nseHolidays.some((d) => d.startsWith(String(currentYear)));
    if (!hasCurrentYear) {
      process.stderr.write(
        `[scheduler] WARNING: nseHolidays in config does not contain entries for ${currentYear}. Trading day detection may be inaccurate.\n`,
      );
    }
  }
}
