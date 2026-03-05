import { describe, it, expect, beforeEach } from 'vitest';
import { ApiTracker } from '../src/utils/api-tracker.js';

let tracker: ApiTracker;

beforeEach(() => {
  tracker = new ApiTracker();
});

describe('ApiTracker.track', () => {
  it('increments count for a service', () => {
    tracker.track('angel_one');
    expect(tracker.getCount('angel_one')).toBe(1);
    tracker.track('angel_one');
    expect(tracker.getCount('angel_one')).toBe(2);
  });

  it('tracks multiple services independently', () => {
    tracker.track('angel_one');
    tracker.track('nse');
    tracker.track('nse');
    expect(tracker.getCount('angel_one')).toBe(1);
    expect(tracker.getCount('nse')).toBe(2);
  });
});

describe('ApiTracker.getSessionCounts', () => {
  it('returns all tracked services', () => {
    tracker.track('gemini');
    tracker.track('gemini');
    tracker.track('screener');
    const counts = tracker.getSessionCounts();
    expect(counts['gemini']).toBe(2);
    expect(counts['screener']).toBe(1);
  });

  it('returns empty object when nothing tracked', () => {
    expect(tracker.getSessionCounts()).toEqual({});
  });
});

describe('ApiTracker.reset', () => {
  it('clears all counts', () => {
    tracker.track('angel_one');
    tracker.track('nse');
    tracker.reset();
    expect(tracker.getSessionCounts()).toEqual({});
    expect(tracker.getCount('angel_one')).toBe(0);
  });
});
