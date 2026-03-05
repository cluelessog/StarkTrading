export interface FallbackOption<T> {
  name: string;
  fn: () => Promise<T>;
}

export interface FallbackResult<T> {
  value: T;
  source: string;
  fallbacksAttempted: string[];
}

export async function withFallback<T>(
  options: FallbackOption<T>[],
  onFallback?: (name: string, error: Error) => void,
): Promise<FallbackResult<T>> {
  const fallbacksAttempted: string[] = [];
  const errors: Error[] = [];

  for (const option of options) {
    try {
      const value = await option.fn();
      return { value, source: option.name, fallbacksAttempted };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push(error);
      fallbacksAttempted.push(option.name);
      if (onFallback) {
        onFallback(option.name, error);
      }
    }
  }

  throw new AggregateError(errors, `All ${options.length} fallback options failed`);
}
