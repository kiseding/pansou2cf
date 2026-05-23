// Dynamic concurrency pool — maintains N concurrent tasks, feeds new ones as old complete.
// Unlike Promise.allSettled, never waits for the slowest task before reporting results.

type TaskFn<T> = () => Promise<T>;

interface Task<T> {
  fn: TaskFn<T>;
  id: string;
  priority: number;
}

export class DynamicPool<T> {
  private concurrency: number;
  private queue: Task<T>[] = [];
  private results: T[] = [];
  private deadline: number;

  constructor(concurrency: number, timeoutMs: number = 10000) {
    this.concurrency = concurrency;
    this.deadline = Date.now() + timeoutMs;
  }

  add(fn: TaskFn<T>, id: string, priority = 0): void {
    this.queue.push({ fn, id, priority });
  }

  async execute(onResult: (id: string, value: T) => void): Promise<T[]> {
    this.queue.sort((a, b) => a.priority - b.priority);

    const pending = new Set<Promise<void>>();
    let idx = 0;

    const runOne = async (task: Task<T>): Promise<void> => {
      try {
        const result = await task.fn();
        if (Date.now() < this.deadline) {
          this.results.push(result);
          onResult(task.id, result);
        }
      } catch {
        // silently skip failed tasks
      }
    };

    // Keep pool full until queue empty or deadline passed
    while (idx < this.queue.length && Date.now() < this.deadline) {
      // Fill pool up to concurrency
      while (pending.size < this.concurrency && idx < this.queue.length) {
        const task = this.queue[idx++];
        const p = runOne(task).finally(() => pending.delete(p));
        pending.add(p);
      }

      // Wait for at least one task to complete before adding more
      if (pending.size > 0) {
        await Promise.race(Array.from(pending));
      }
    }

    // Wait for remaining in-flight tasks (up to deadline)
    if (pending.size > 0) {
      const remaining = Promise.allSettled(Array.from(pending));
      const limit = new Promise<void>(r => setTimeout(r, Math.max(0, this.deadline - Date.now())));
      await Promise.race([remaining, limit]);
    }

    return this.results;
  }
}
