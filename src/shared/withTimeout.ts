/**
 * Race a promise against a timeout. Resolves to `null` if `ms` elapses first
 * or if the wrapped promise rejects.
 *
 * This is the resilience primitive for cross-boundary calls where we'd
 * rather degrade to metadata-only than block a whole freeze because one
 * content script is stuck (still loading, blocked on a modal, etc.).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    promise
      .then((value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}
