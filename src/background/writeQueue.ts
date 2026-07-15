/**
 * Serializes multi-step storage operations by chaining them onto a single
 * FIFO promise. Only one task runs at a time; each awaits the previous.
 *
 * Why not just rely on chrome.storage.local's per-key atomicity?
 * Because a save touches TWO keys (blob + index). Between those writes, a
 * second concurrent handler could read the stale index and clobber the
 * first write. This queue collapses those into a strict serial order.
 *
 * Errors in one task never break the chain — subsequent tasks still run.
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => task());
    // Swallow errors ONLY on the tail — the caller's `result` still rejects.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
