import { describe, it, expect } from 'vitest';
import { WriteQueue } from './writeQueue';

// A helper to introduce a controllable delay in tests.
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('WriteQueue', () => {
  it('runs tasks in FIFO order even when earlier tasks are slower', async () => {
    const q = new WriteQueue();
    const order: number[] = [];

    const p1 = q.enqueue(async () => {
      await delay(30);
      order.push(1);
    });
    const p2 = q.enqueue(async () => {
      await delay(1);
      order.push(2);
    });
    const p3 = q.enqueue(async () => {
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('propagates errors to the caller without breaking the chain', async () => {
    const q = new WriteQueue();
    const order: number[] = [];

    const bad = q.enqueue(async () => {
      throw new Error('boom');
    });
    const good = q.enqueue(async () => {
      order.push(1);
      return 'ok';
    });

    await expect(bad).rejects.toThrow(/boom/);
    await expect(good).resolves.toBe('ok');
    expect(order).toEqual([1]);
  });

  it('returns the task result to the caller', async () => {
    const q = new WriteQueue();
    const result = await q.enqueue(async () => 42);
    expect(result).toBe(42);
  });

  it('serializes concurrent multi-step writes correctly', async () => {
    // Simulate the exact bug the queue prevents: two writers that each
    // read-then-write a shared counter. Without the queue this would race.
    const q = new WriteQueue();
    const shared = { value: 0 };

    const writer = () =>
      q.enqueue(async () => {
        const snapshot = shared.value;
        await delay(5); // yield — this is where the race would happen
        shared.value = snapshot + 1;
      });

    await Promise.all([writer(), writer(), writer(), writer(), writer()]);
    expect(shared.value).toBe(5);
  });
});
