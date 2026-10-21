import { test } from "node:test";
import assert from "node:assert/strict";
import { createSerialQueue } from "./serialQueue";

test("serial queue runs one job at a time, in order, and ignores duplicates", async () => {
  const events: string[] = [];
  let running = 0;
  let maxRunning = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queue = createSerialQueue(async (id) => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    try {
      events.push(`start ${id}`);
      if (id === "a") await gate;
      if (id === "b") throw new Error("boom");
      events.push(`end ${id}`);
    } finally {
      running--;
    }
  });

  assert.equal(queue.add("a"), true);
  assert.equal(queue.add("b"), true);
  assert.equal(queue.add("c"), true);
  assert.equal(queue.add("a"), false);
  assert.equal(queue.add("c"), false);
  assert.deepEqual(
    ["a", "b", "c", "z"].map((id) => queue.position(id)),
    [0, 1, 2, -1],
  );

  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["start a", "end a", "start b", "start c", "end c"]);
  assert.equal(maxRunning, 1);
  assert.equal(queue.has("c"), false);
  assert.equal(queue.add("a"), true);
});
