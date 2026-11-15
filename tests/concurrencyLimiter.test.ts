import { describe, expect, it, vi } from 'vitest';
import { withConcurrencyLimit } from '../src/client/concurrencyLimiter.js';

function deferredTask() {
  let active = 0;
  let peak = 0;
  const releaseFns: Array<() => void> = [];
  const task = vi.fn(async (id: number): Promise<number> => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => {
      releaseFns.push(resolve);
    });
    active--;
    return id;
  });
  return {
    task,
    peak: () => peak,
    release: () => releaseFns.shift()?.(),
  };
}

describe('withConcurrencyLimit', () => {
  it('runs at most `max` tasks concurrently while queued callers wait', async () => {
    const { task, peak, release } = deferredTask();
    const limited = withConcurrencyLimit(2, task);

    const promises = [limited(1), limited(2), limited(3), limited(4), limited(5)];

    // Nothing can finish until we release; two must be running, three queued.
    await Promise.resolve();
    expect(peak()).toBe(2);

    release(); // task 1 finishes -> task 3 starts
    await Promise.resolve();
    expect(peak()).toBe(2);

    // Release one gate per macrotask tick so each finishing task lets the
    // next queued one register its own gate.
    for (let i = 0; i < 6; i++) {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await expect(Promise.all(promises)).resolves.toEqual([1, 2, 3, 4, 5]);
    expect(task).toHaveBeenCalledTimes(5);
  });
});
