// Shim for bun:test — re-exports vitest equivalents
export { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';

// bun:test mock() creates a mock function, equivalent to vi.fn()
export function mock<T extends (...args: any[]) => any>(impl?: T) {
  return impl ? vi.fn(impl) : vi.fn();
}

// bun:test setSystemTime() — uses vi.useFakeTimers/vi.useRealTimers
export function setSystemTime(date?: Date) {
  if (date) {
    vi.useFakeTimers();
    vi.setSystemTime(date);
  } else {
    vi.useRealTimers();
  }
}
