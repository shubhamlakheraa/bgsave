import { describe, it, expect } from 'vitest';
import { withTimeout } from './withTimeout';

describe('withTimeout', () => {
  it('resolves with the promise value when it beats the deadline', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 100);
    expect(result).toBe('ok');
  });

  it('resolves null when the deadline fires first', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 50));
    const result = await withTimeout(slow, 5);
    expect(result).toBeNull();
  });

  it('resolves null when the wrapped promise rejects', async () => {
    const result = await withTimeout(Promise.reject(new Error('boom')), 100);
    expect(result).toBeNull();
  });

  it('does not resolve twice when the wrapped promise settles after the deadline', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 40));
    const first = await withTimeout(slow, 5);
    expect(first).toBeNull();
    // Wait long enough for `slow` to also settle, and confirm no crash.
    await slow;
  });
});
