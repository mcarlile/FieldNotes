/**
 * Runs jobs one at a time in the order they were added. Adding an id that is
 * already queued or running does nothing, so a double click can't start a
 * second copy of the same job.
 */
export function createSerialQueue(run: (id: string) => Promise<void>) {
  const waiting: string[] = [];
  let current: string | null = null;

  async function pump(): Promise<void> {
    if (current !== null) return;
    while (waiting.length > 0) {
      current = waiting.shift()!;
      try {
        await run(current);
      } catch (error) {
        console.error(`Queued job ${current} failed:`, error);
      } finally {
        current = null;
      }
    }
  }

  return {
    add(id: string): boolean {
      if (current === id || waiting.includes(id)) return false;
      waiting.push(id);
      void pump();
      return true;
    },
    has(id: string): boolean {
      return current === id || waiting.includes(id);
    },
    /** 0 while running, 1+ while waiting, -1 when not in the queue. */
    position(id: string): number {
      if (current === id) return 0;
      const index = waiting.indexOf(id);
      return index === -1 ? -1 : index + 1;
    },
  };
}
