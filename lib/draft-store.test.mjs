import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  clearDraft,
  flushDraftPersistence,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft,
  restoreDraftSubmission,
  setDraft,
} = await jiti.import("./draft-store.ts");

function withLocalStorage(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const entries = new Map();
  const storage = {
    get length() { return entries.size; },
    key(index) { return Array.from(entries.keys())[index] ?? null; },
    getItem(key) { return entries.get(String(key)) ?? null; },
    setItem(key, value) { entries.set(String(key), String(value)); },
    removeItem(key) { entries.delete(String(key)); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    return run(storage);
  } finally {
    flushDraftPersistence();
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
}

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

test("native clearDraft removes the durable v3 owner synchronously after an accepted send", () => {
  withLocalStorage((storage) => {
    const key = "session-native-clear-sync";
    clearDraft(key);

    assert.equal(setDraft(key, { value: "already sent", images: [makeImage(91)] }), true);
    const storageKey = `pi-enh-composer-draft-v3:${encodeURIComponent(key)}`;
    flushDraftPersistence();
    assert.equal(JSON.parse(storage.getItem(storageKey)).value, "already sent");

    assert.equal(clearDraft(key), true);
    assert.equal(storage.getItem(storageKey), null);
    assert.equal(getDraft(key), null);
  });
});

test("native draft hydration promotes a workspace-scoped provisional draft and clear removes its new owner", () => {
  withLocalStorage((storage) => {
    const cwd = "/tmp/native-draft-hydration";
    const key = `new:refresh-id:${cwd}`;
    const scopedKey = `pi-enh-composer-draft-v3:new-scoped:${encodeURIComponent(cwd)}`;
    const image = makeImage(92);
    storage.setItem(scopedKey, JSON.stringify({
      version: 3,
      ownerKey: `new:old-id:${cwd}`,
      value: "restore after refresh",
      images: [image],
      updatedAt: Date.now(),
    }));

    assert.deepEqual(getDraft(key), { value: "restore after refresh", images: [image] });
    const exactKey = `pi-enh-composer-draft-v3:${encodeURIComponent(key)}`;
    assert.equal(JSON.parse(storage.getItem(exactKey)).ownerKey, key);
    assert.equal(JSON.parse(storage.getItem(scopedKey)).ownerKey, key);

    clearDraft(key);
    assert.equal(storage.getItem(exactKey), null);
    assert.equal(storage.getItem(scopedKey), null);
  });
});

test("failed submission recovery keeps the submitted images ahead of new input and persists the merged draft", () => {
  withLocalStorage((storage) => {
    const key = "session-native-failure-recovery";
    const submittedImage = makeImage(93);
    const newImage = makeImage(94);
    clearDraft(key);
    setDraft(key, { value: "new text typed after send", images: [newImage] });

    const recovered = restoreDraftSubmission(key, "failed send", [submittedImage]);
    assert.deepEqual(recovered, {
      value: "failed send\n\nnew text typed after send",
      images: [submittedImage, newImage],
    });
    const storageKey = `pi-enh-composer-draft-v3:${encodeURIComponent(key)}`;
    flushDraftPersistence();
    const persisted = JSON.parse(storage.getItem(storageKey));
    assert.equal(persisted.version, 3);
    assert.equal(persisted.ownerKey, key);
    assert.equal(persisted.value, "failed send\n\nnew text typed after send");
    assert.deepEqual(persisted.images, [submittedImage, newImage]);
    assert.equal(typeof persisted.updatedAt, "number");
    clearDraft(key);
  });
});

test("native provisional rekey moves both text and image persistence without retaining its scoped owner", () => {
  withLocalStorage((storage) => {
    const cwd = "/tmp/native-draft-rekey";
    const previousKey = `new:rekey-id:${cwd}`;
    const nextKey = "session-native-rekey";
    const previousImage = makeImage(95);
    const nextImage = makeImage(96);
    clearDraft(previousKey);
    clearDraft(nextKey);
    setDraft(previousKey, { value: "provisional draft", images: [previousImage] });
    setDraft(nextKey, { value: "target draft", images: [nextImage] });

    assert.deepEqual(rekeyDraft(previousKey, nextKey), {
      value: "target draft\n\nprovisional draft",
      images: [nextImage, previousImage],
    });
    assert.equal(storage.getItem(`pi-enh-composer-draft-v3:${encodeURIComponent(previousKey)}`), null);
    assert.equal(storage.getItem(`pi-enh-composer-draft-v3:new-scoped:${encodeURIComponent(cwd)}`), null);
    flushDraftPersistence();
    assert.deepEqual(JSON.parse(storage.getItem(`pi-enh-composer-draft-v3:${encodeURIComponent(nextKey)}`)).images,
      [nextImage, previousImage]);
    clearDraft(nextKey);
  });
});

test("disabled draft persistence keeps page memory and neither restores nor writes durable drafts", () => {
  withLocalStorage((storage) => {
    const key = "disabled-durable-owner";
    const storageKey = `pi-enh-composer-draft-v3:${key}`;
    storage.setItem(storageKey, JSON.stringify({ version:3, ownerKey:key, value:"old durable draft", images:[], updatedAt:Date.now() }));
    storage.setItem("pi-enh-plugin-composer-draft-cache", "false");
    assert.equal(getDraft(key), null);
    setDraft(key, { value:"current page draft", images:[] });
    flushDraftPersistence();
    assert.equal(getDraft(key).value, "current page draft");
    assert.equal(JSON.parse(storage.getItem(storageKey)).value, "old durable draft");
    clearDraft(key);
    assert.equal(storage.getItem(storageKey), null);
  });
});
test("coalesced persistence saves the latest value and cannot resurrect a cleared owner", () => {
  withLocalStorage((storage) => {
    const key = "coalesced-draft-owner", storageKey=`pi-enh-composer-draft-v3:${key}`;
    setDraft(key, { value:"first", images:[] });
    setDraft(key, { value:"latest", images:[] });
    assert.equal(storage.getItem(storageKey), null, "no serialization per key stroke");
    flushDraftPersistence();
    assert.equal(JSON.parse(storage.getItem(storageKey)).value, "latest");
    setDraft(key, { value:"sent", images:[] });clearDraft(key);flushDraftPersistence();
    assert.equal(storage.getItem(storageKey), null);
  });
});

 test("refresh keys restore the newest draft in the exact workspace, including Windows paths", () => {
  for (const cwd of ["/tmp/new-button-refresh", "C:\\Work\\refresh"]) {
    withLocalStorage((storage) => {
      const key = `new:initial:${cwd}:${cwd}`;
      const scopedKey = `pi-enh-composer-draft-v3:new-scoped:${encodeURIComponent(cwd)}`;
      storage.setItem(`pi-enh-composer-draft-v3:${encodeURIComponent(key)}`, JSON.stringify({version:3,ownerKey:key,value:"old text",images:[],updatedAt:Date.now()-10000}));
      storage.setItem(scopedKey, JSON.stringify({version:3,ownerKey:`new:uuid:${cwd}`,value:"latest text",images:[],updatedAt:Date.now()}));
      assert.deepEqual(getDraft(key), {value:"latest text",images:[]});
      assert.equal(JSON.parse(storage.getItem(scopedKey)).ownerKey,key);
      clearDraft(key);
      assert.equal(storage.getItem(scopedKey),null);
    });
  }
});
