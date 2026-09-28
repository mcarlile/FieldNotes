import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTripPhotos } from "./photo-limit";

test("trip create accepts exactly 100 and rejects 101", () => {
  const photos = Array.from({ length: 101 }, (_, i) => ({ filename: `${i}.jpg` }));
  assert.equal(validateTripPhotos(photos.slice(0, 100)), null);
  assert.match(validateTripPhotos(photos)!, /at most 100/);
  assert.match(validateTripPhotos({}), /array/);
});

test("legacy edits may keep or reduce existing photos but not add any over the cap", () => {
  const ids = Array.from({ length: 110 }, (_, i) => `id-${i}`);
  assert.equal(validateTripPhotos(ids.map(id => ({ id })), ids), null);
  assert.equal(validateTripPhotos(ids.slice(0, 105).map(id => ({ id })), ids), null);
  assert.match(validateTripPhotos([...ids.map(id => ({ id })), { filename: "new" }], ids)!, /at most 100/);
  assert.match(validateTripPhotos(ids.map(id => ({ id })).concat({ id: ids[0] }), ids)!, /duplicate/);
  assert.equal(validateTripPhotos(undefined, ids), null);
});