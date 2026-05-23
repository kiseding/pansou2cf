// Dynamic concurrency pool — maintains N concurrent tasks, feeds new ones as old complete.
// Unlike Promise.allSettled, never waits for the slowest task before reporting results.

type TaskFn<T> = () => Promise<T>;

interface Task<T> {
  fn: TaskFn<T>;
  id: string;
  priority: number; // lower = higher priority
}

export class DynamicPool<T> {
  private concurrency: number;
  private queue: Task<T>[];
  private running = 0;
  private results: T[] = [];
  private deadline: number; // ms timestamp after which we stop

  constructor(concurrency: number, timeoutMs: number = 10000) {
    this.concurrency = concurrency;
    this.queue = [];
    this.deadline = Date.now() + timeoutMs;
  }

  add(fn: TaskFn<T>, id: string, priority = 0): void {
    this.queue.push({ fn, id, priority });
  }

  // Execute all tasks, calling onResult for each completed task
  async execute(onResult: (id: string, value: T) => void): Promise<T[]> {
    // Sort by priority (lower first)
    this.queue.sort((a, b) => a.priority - b.priority);

    // Track which tasks we've started
    const pending = new Set(this.queue.map(t => t.id));
    let nextIdx = 0;

    const runTask = async (task: Task<T>) => {
      this.running++;
      try {
        const result = await task.fn();
        if (Date.now() < this.deadline) {
          this.results.push(result);
          onResult(task.id, result);
        }
      } catch {
        // Task failed, skip
      } finally {
        this.running--;
        pending.delete(task.id);
      }
    };

    // Kick off initial batch
    const initial = Math.min(this.concurrency, this.queue.length);
    const started: Promise<void>[] = [];
    for (let i = 0; i < initial; i++) {
      started.push(runTask(this.queue[i]));
      nextIdx = i + 1;
    }

    // As each task completes, start the next one from the queue
    while (nextIdx < this.queue.length && Date.now() < this.deadline) {
      // Wait for any running task to complete
      if (this.running >= this.concurrency) {
        await Promise.race(started);
        // Remove completed promises
        for (let i = started.length - 1; i >= 0; i--) {
          const p = started[i];
          // Check if settled
          let settled = false;
          await p.then(() => { settled = true; }).catch(() => { settled = true; });
          if (settled) started.splice(i, 1);
        }
      }
      // Start next task
      if (nextIdx < this.queue.length && this.running < this.concurrency && Date.now() < this.deadline) {
        started.push(runTask(this.queue[nextIdx]));
        nextIdx++;
      }
    }

    // Wait for remaining in-flight tasks (up to deadline)
    if (started.length > 0) {
      const remaining = Promise.allSettled(started);
      const deadline = new Promise<void>(r => setTimeout(r, Math.max(0, this.deadline - Date.now())));
      await Promise.race([remaining, deadline]);
    }

    return this.results;
  }
}
