import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  clearDraft,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft,
  restoreDraftSubmission,
  setDraft,
} = await jiti.import("./draft-store.ts");

function makeImage(index) {
  const raw = `img-${String(index).padStart(2, "0")}`;
  return {
    data: Buffer.from(raw, "utf8").toString("base64"),
    mimeType: "image/png",
  };
}

test("mergeRestoredSubmissionDraft and restoreDraftSubmission preserve all valid images beyond 10 while filtering invalid ones", () => {
  const key = "draft-over-limit-test";
  clearDraft(key);

  const recalledImages = [makeImage(1), makeImage(2)];
  const existingImages = Array.from({ length: 9 }, (_, idx) => makeImage(idx + 3));
  const invalidImage = { data: "not-base64!", mimeType: "image/png" };

  setDraft(key, {
    value: "existing draft text",
    images: existingImages,
  });

  const merged = mergeRestoredSubmissionDraft(
    "recalled text",
    [...recalledImages, invalidImage],
    "existing draft text",
    existingImages,
  );

  assert.equal(merged.value, "recalled text\n\nexisting draft text");
  assert.equal(merged.images.length, 11);
  assert.deepEqual(merged.images, [...recalledImages, ...existingImages]);

  const restored = restoreDraftSubmission(key, "recalled text", [...recalledImages, invalidImage]);
  assert.equal(restored.value, "recalled text\n\nexisting draft text");
  assert.equal(restored.images.length, 11);
  assert.deepEqual(getDraft(key), {
    value: "recalled text\n\nexisting draft text",
    images: [...recalledImages, ...existingImages],
  });

  clearDraft(key);
});

test("rekeyDraft preserves all valid images across provisional and target keys without silent truncation", () => {
  const prevKey = "new:/tmp/draft-rekey-a";
  const nextKey = "session-draft-rekey-b";
  clearDraft(prevKey);
  clearDraft(nextKey);

  const nextImages = [makeImage(1), makeImage(2)];
  const prevImages = Array.from({ length: 9 }, (_, idx) => makeImage(idx + 3));

  setDraft(nextKey, { value: "queued on target", images: nextImages });
  setDraft(prevKey, { value: "typed in provisional", images: prevImages });

  const moved = rekeyDraft(prevKey, nextKey);
  assert.equal(getDraft(prevKey), null);
  assert.deepEqual(moved, {
    value: "queued on target\n\ntyped in provisional",
    images: [...nextImages, ...prevImages],
  });
  assert.equal(getDraft(nextKey)?.images.length, 11);
  assert.equal(
    mergeRestoredSubmissionText("first part", "second part"),
    "first part\n\nsecond part",
  );

  clearDraft(nextKey);
});
