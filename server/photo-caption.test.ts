import { test } from "node:test";
import assert from "node:assert/strict";
import { existingPhotoCaptionPatch } from "./photo-caption";

test("existing photo caption updates preserve unrelated EXIF fields", () => {
  const oldPhoto = { altText: "old", camera: "Leica", latitude: 42, timestamp: new Date("2024-01-01") };
  assert.deepEqual({ ...oldPhoto, ...existingPhotoCaptionPatch({ caption: "new" }) }, {
    ...oldPhoto, altText: "new",
  });
  assert.deepEqual(existingPhotoCaptionPatch({ caption: "" }), { altText: "" });
  assert.equal(existingPhotoCaptionPatch({}), null);
});