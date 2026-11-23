/**
 * Runs async tasks one at a time per key, in arrival order.
 *
 * In-memory, so it serialises work within one API instance, which is the same
 * scope as MemoryRateLimiter. Idle keys are dropped so memory stays bounded.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(task, task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
