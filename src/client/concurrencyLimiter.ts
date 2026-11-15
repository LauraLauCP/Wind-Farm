/**
 * Wraps an async task with a concurrency cap (Q6): at most `max` invocations
 * run at once, the rest queue in FIFO order. Used to keep concurrent cache
 * misses from stampeding the AEMET OpenData API (its free keys are limited
 * to roughly 50 requests per minute, and each logical query costs 2 HTTP calls).
 */
export function withConcurrencyLimit<A extends unknown[], R>(
  max: number,
  task: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = async (): Promise<void> => {
    if (active < max) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => {
      queue.push(resolve);
    });
    active++;
  };

  const release = (): void => {
    active--;
    queue.shift()?.();
  };

  return async (...args: A): Promise<R> => {
    await acquire();
    try {
      return await task(...args);
    } finally {
      release();
    }
  };
}
