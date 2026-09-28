import { test } from "node:test";
import assert from "node:assert/strict";
import { countOccupiedPhotoSlots, runUploadQueue, summarizeUploadBatch } from "./upload-queue";

test("bulk uploads never exceed three active workers and results stay in selection order", async () => {
  let active = 0;
  let maximum = 0;
  const result = await runUploadQueue(Array.from({ length: 100 }, (_, i) => i), async (i) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, i % 3));
    active--;
    return i % 4 === 0 ? { failed: i } : { successful: i, exif: `exif-${i}` };
  });
  assert.equal(maximum, 3);
  assert.deepEqual(result.map((r, i) => "failed" in r ? r.failed : r.successful), Array.from({ length: 100 }, (_, i) => i));
  assert.equal(result.filter(r => "failed" in r).length, 25);
  assert.deepEqual(result.filter(r => "successful" in r).map(r => r.exif), Array.from({ length: 100 }, (_, i) => i).filter(i => i % 4 !== 0).map(i => `exif-${i}`));
});

test("all failed uploads still return a result for each item", async () => {
  assert.deepEqual(await runUploadQueue([1, 2], async i => ({ failed: i })), [{ failed: 1 }, { failed: 2 }]);
});

test("completion reports failures even when every file fails and aligns EXIF only with successes", () => {
  const failed = { successful: null, failed: { id: "a", error: "network" }, exifData: null };
  assert.deepEqual(summarizeUploadBatch([failed], () => ({})), {
    successful: [], failed: [failed.failed], exifData: [],
  });
  const success = { successful: { id: "b" }, failed: null, exifData: { camera: "B" } };
  assert.deepEqual(summarizeUploadBatch([failed, success, { successful: { id: "c" }, failed: null, exifData: null }], () => ({})), {
    successful: [{ id: "b" }, { id: "c" }], failed: [failed.failed], exifData: [{ camera: "B" }, {}],
  });
  // A retry comprises only previously failed items; prior successes must not be emitted again.
  assert.deepEqual(summarizeUploadBatch([success], () => ({})).successful, [{ id: "b" }]);
});

test("completed row hidden before callback reserves a slot, then acknowledged deletion frees it", () => {
  const unacknowledged = new Set(["upload-a"]);
  const files = [{ status: "uploading" }, { status: "error" }];
  assert.equal(countOccupiedPhotoSlots(98, files, unacknowledged, []), 100);
  assert.equal(countOccupiedPhotoSlots(99, files, unacknowledged, ["upload-a"]), 100);
  // Deleting the successful photo in the editor must not restore its reservation.
  assert.equal(countOccupiedPhotoSlots(98, files, unacknowledged, ["upload-a"]), 99);
});