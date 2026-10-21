import assert from "node:assert/strict";
import test from "node:test";

import { eachLimited } from "#lib/each-limited";

void test("eachLimited runs every item with at most `limit` in flight", async () => {
  let running = 0;
  let peak = 0;
  const seen: number[] = [];
  await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    seen.push(item);
    running -= 1;
  });
  assert.equal(peak, 3);
  assert.deepEqual(
    seen.toSorted((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7],
  );
});

void test("eachLimited resolves at once for no items", async () => {
  await eachLimited([], 3, async () => {
    await Promise.reject(new Error("no task should run"));
  });
});
