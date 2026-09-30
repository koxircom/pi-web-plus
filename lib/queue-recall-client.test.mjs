import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createJiti } from "jiti";
import * as queueActions from "./queue-actions.ts";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  clearDraft,
  getDraft,
  restoreDraftSubmission,
  setDraft,
} = await jiti.import("./draft-store.ts");
const {
  extractSnapshotTokens,
  mergeRecalledQueueEntries,
  recallSessionQueue,
  validateRecallAllResponse,
} = await jiti.import("./queue-recall-client.ts");

function createQueuedUserMessage(text, images = []) {
  const content = [];
  if (text) {
    content.push({ type: "text", text });
  }
  for (const img of images) {
    content.push({
      type: "image",
      data: img.data,
      mimeType: img.mimeType,
    });
  }
  return {
    role: "user",
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    timestamp: Date.now(),
  };
}

function createFakeQueueSession(sessionId = "session-test") {
  const agent = new Agent({
    streamFn: async () => {
      throw new Error("Model streamFn must not be invoked during queue recall tests");
    },
  });
  agent.state.isStreaming = true;

  return {
    sessionId,
    isStreaming: true,
    isCompacting: false,
    agent,
    _steeringMessages: [],
    _followUpMessages: [],
    emitCount: 0,
    clearQueueCalls: 0,
    _emitQueueUpdate() {
      this.emitCount += 1;
    },
    enqueueSteering(text, images = []) {
      const msg = createQueuedUserMessage(text, images);
      this.agent.steer(msg);
      this._steeringMessages.push(text);
      return msg;
    },
    enqueueFollowUp(text, images = []) {
      const msg = createQueuedUserMessage(text, images);
      this.agent.followUp(msg);
      this._followUpMessages.push(text);
      return msg;
    },
    clearQueue() {
      this.clearQueueCalls += 1;
      throw new Error("clear_queue must never be called by native queue recall");
    },
  };
}

function createRpcDispatcher(sessionsById) {
  const calls = [];
  const sendCommand = async (sessionId, command) => {
    calls.push({ sessionId, command });
    const session = sessionsById.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    switch (command.type) {
      case "get_queue_actions":
        return queueActions.snapshot(session);
      case "recall_all_queued_messages":
        return queueActions.recallAll(session, command.tokens);
      case "clear_queue":
        return session.clearQueue();
      default:
        throw new Error(`Unexpected command type: ${command.type}`);
    }
  };
  return { sendCommand, calls };
}

test("recalls queued messages with two images + plain text in steering/followUp order without clear_queue", async () => {
  const sessionId = "session-two-images";
  clearDraft(sessionId);
  const session = createFakeQueueSession(sessionId);
  const img1 = { data: "aW1hZ2Utb25l", mimeType: "image/png" };
  const img2 = { data: "aW1hZ2UtdHdv", mimeType: "image/jpeg" };

  session.enqueueSteering("steer with two images", [img1, img2]);
  session.enqueueFollowUp("follow-up plain text", []);

  const { sendCommand, calls } = createRpcDispatcher(new Map([[sessionId, session]]));
  let clearedUiCount = 0;
  const notices = [];
  const restoredCalls = [];

  const outcome = await recallSessionQueue({
    sessionId,
    targetDraftKey: sessionId,
    sendCommand,
    restoreSubmission(text, images, targetDraftKey) {
      restoredCalls.push({ text, images, targetDraftKey });
      restoreDraftSubmission(
        targetDraftKey,
        text,
        images?.map(({ data, mimeType }) => ({ data, mimeType })),
      );
    },
    isSameSession: (originSid) => originSid === sessionId,
    clearQueuedMessagesUi: () => {
      clearedUiCount += 1;
    },
    onError: (message, err) => {
      notices.push({ message, err });
    },
  });

  assert.equal(outcome.recalled, true);
  assert.equal(notices.length, 0);
  assert.equal(session.clearQueueCalls, 0);
  assert.deepEqual(
    calls.map((c) => c.command.type),
    ["get_queue_actions", "recall_all_queued_messages"],
  );
  assert.equal(clearedUiCount, 1);
  assert.equal(restoredCalls.length, 1);
  assert.equal(restoredCalls[0].targetDraftKey, sessionId);
  assert.equal(restoredCalls[0].text, "steer with two images\n\nfollow-up plain text");
  assert.deepEqual(restoredCalls[0].images, [
    {
      data: img1.data,
      mimeType: img1.mimeType,
      previewUrl: `data:${img1.mimeType};base64,${img1.data}`,
    },
    {
      data: img2.data,
      mimeType: img2.mimeType,
      previewUrl: `data:${img2.mimeType};base64,${img2.data}`,
    },
  ]);

  const draft = getDraft(sessionId);
  assert.deepEqual(draft, {
    value: "steer with two images\n\nfollow-up plain text",
    images: [img1, img2],
  });
  assert.equal(session.agent.steeringQueue.messages.length, 0);
  assert.equal(session.agent.followUpQueue.messages.length, 0);
  clearDraft(sessionId);
});

test("merges recalled text and images ahead of existing draft text and images", async () => {
  const sessionId = "session-with-existing-draft";
  clearDraft(sessionId);
  const existingImg = { data: "ZXhpc3RpbmctaW1n", mimeType: "image/webp" };
  setDraft(sessionId, {
    value: "already typed in composer",
    images: [existingImg],
  });

  const session = createFakeQueueSession(sessionId);
  const queuedImg1 = { data: "cXVldWVkLWltZy0x", mimeType: "image/png" };
  const queuedImg2 = { data: "cXVldWVkLWltZy0y", mimeType: "image/gif" };
  session.enqueueSteering("first queued with img1", [queuedImg1]);
  session.enqueueFollowUp("second queued with img2", [queuedImg2]);

  const { sendCommand } = createRpcDispatcher(new Map([[sessionId, session]]));
  let clearedUi = false;

  const outcome = await recallSessionQueue({
    sessionId,
    targetDraftKey: sessionId,
    sendCommand,
    restoreSubmission(text, images, targetDraftKey) {
      restoreDraftSubmission(
        targetDraftKey,
        text,
        images?.map(({ data, mimeType }) => ({ data, mimeType })),
      );
    },
    isSameSession: () => true,
    clearQueuedMessagesUi: () => {
      clearedUi = true;
    },
  });

  assert.equal(outcome.recalled, true);
  assert.equal(clearedUi, true);
  assert.deepEqual(getDraft(sessionId), {
    value: "first queued with img1\n\nsecond queued with img2\n\nalready typed in composer",
    images: [queuedImg1, queuedImg2, existingImg],
  });
  clearDraft(sessionId);
});

test("does not clear queue UI or touch draft when token expires, RPC fails, or backend returns legacy payload", async () => {
  const sessionId = "session-failure-safety";
  clearDraft(sessionId);
  const draftImg = { data: "ZHJhZnQtaW1n", mimeType: "image/png" };
  setDraft(sessionId, {
    value: "keep this draft safe",
    images: [draftImg],
  });

  const session = createFakeQueueSession(sessionId);
  const queuedImg = { data: "cXVldWVkLXNhZmU=", mimeType: "image/png" };
  session.enqueueFollowUp("queued item with image", [queuedImg]);

  let restoreCalled = false;
  let clearUiCalled = false;
  const errors = [];

  // Case 1: concurrent queue change between get_queue_actions and recall_all_queued_messages (stale token)
  const outcomeStale = await recallSessionQueue({
    sessionId,
    targetDraftKey: sessionId,
    sendCommand: async (sid, cmd) => {
      if (cmd.type === "get_queue_actions") {
        const snap = queueActions.snapshot(session);
        // Simulate another message enqueued before recall_all arrives
        session.enqueueFollowUp("concurrent arrival", []);
        return snap;
      }
      if (cmd.type === "recall_all_queued_messages") {
        return queueActions.recallAll(session, cmd.tokens);
      }
      throw new Error(`Unexpected command: ${cmd.type}`);
    },
    restoreSubmission() {
      restoreCalled = true;
    },
    clearQueuedMessagesUi() {
      clearUiCalled = true;
    },
    onError(message, error) {
      errors.push({ message, error });
    },
  });

  assert.equal(outcomeStale.recalled, false);
  assert.equal(outcomeStale.reason, "error");
  assert.equal(restoreCalled, false);
  assert.equal(clearUiCalled, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "Failed to recall queued messages");
  assert.equal(session.agent.followUpQueue.messages.length, 2);
  assert.deepEqual(getDraft(sessionId), {
    value: "keep this draft safe",
    images: [draftImg],
  });

  // Case 2: legacy backend response without v2 snapshot tokens must fail closed without clear_queue fallback
  const outcomeLegacy = await recallSessionQueue({
    sessionId,
    targetDraftKey: sessionId,
    sendCommand: async (_sid, cmd) => {
      if (cmd.type === "get_queue_actions") {
        return { steering: [], followUp: ["queued item with image"] };
      }
      throw new Error("Should not call follow-up command when snapshot is not v2");
    },
    restoreSubmission() {
      restoreCalled = true;
    },
    clearQueuedMessagesUi() {
      clearUiCalled = true;
    },
    onError(message, error) {
      errors.push({ message, error });
    },
  });

  assert.equal(outcomeLegacy.recalled, false);
  assert.equal(outcomeLegacy.reason, "error");
  assert.equal(restoreCalled, false);
  assert.equal(clearUiCalled, false);
  assert.equal(errors.length, 2);
  assert.equal(session.clearQueueCalls, 0);
  assert.deepEqual(getDraft(sessionId), {
    value: "keep this draft safe",
    images: [draftImg],
  });

  clearDraft(sessionId);
});

test("switching sessions mid-flight restores into origin session draft and never pollutes active session draft or queue UI", async () => {
  const sessionAId = "session-origin-A";
  const sessionBId = "session-active-B";
  clearDraft(sessionAId);
  clearDraft(sessionBId);

  const imgA1 = { data: "c2Vzc2lvbkEtaW1nMQ==", mimeType: "image/png" };
  const imgA2 = { data: "c2Vzc2lvbkEtaW1nMg==", mimeType: "image/jpeg" };
  const imgB = { data: "c2Vzc2lvbkItaW1n", mimeType: "image/png" };

  setDraft(sessionAId, { value: "draft A before switch", images: [] });
  setDraft(sessionBId, { value: "draft B in new session", images: [imgB] });

  const sessionA = createFakeQueueSession(sessionAId);
  sessionA.enqueueSteering("queued in A1", [imgA1]);
  sessionA.enqueueFollowUp("queued in A2", [imgA2]);

  let currentActiveSessionId = sessionAId;
  let activeComposerValue = "draft A before switch";
  let activeComposerImages = [];
  let activeSessionQueueUiCleared = false;

  const { sendCommand } = createRpcDispatcher(new Map([[sessionAId, sessionA]]));

  const outcome = await recallSessionQueue({
    sessionId: sessionAId,
    targetDraftKey: sessionAId,
    sendCommand: async (sid, cmd) => {
      const result = await sendCommand(sid, cmd);
      if (cmd.type === "get_queue_actions") {
        // User switches from session A to session B while recall is in flight
        currentActiveSessionId = sessionBId;
        activeComposerValue = "draft B in new session";
        activeComposerImages = [imgB];
      }
      return result;
    },
    restoreSubmission(text, images, targetDraftKey) {
      const draftImages = images?.map(({ data, mimeType }) => ({ data, mimeType }));
      // Mirrors ChatInput.restoreSubmission: updates draft-store for targetDraftKey,
      // and only mutates live composer state when targetDraftKey === currentActiveSessionId.
      const updated = restoreDraftSubmission(targetDraftKey, text, draftImages);
      if (targetDraftKey === currentActiveSessionId) {
        activeComposerValue = updated.value;
        activeComposerImages = updated.images;
      }
    },
    isSameSession: (originSid) => currentActiveSessionId === originSid,
    clearQueuedMessagesUi: () => {
      activeSessionQueueUiCleared = true;
    },
  });

  assert.equal(outcome.recalled, true);
  assert.equal(outcome.targetDraftKey, sessionAId);
  // Session B's queue UI and live composer must NOT be touched
  assert.equal(activeSessionQueueUiCleared, false);
  assert.equal(activeComposerValue, "draft B in new session");
  assert.deepEqual(activeComposerImages, [imgB]);
  assert.deepEqual(getDraft(sessionBId), {
    value: "draft B in new session",
    images: [imgB],
  });

  // Session A's draft store receives the recalled text + both images ahead of its existing draft
  assert.deepEqual(getDraft(sessionAId), {
    value: "queued in A1\n\nqueued in A2\n\ndraft A before switch",
    images: [imgA1, imgA2],
  });

  clearDraft(sessionAId);
  clearDraft(sessionBId);
});

test("full composer capacity rejects recall before draining either queue", async () => {
  const sid = 'capacity-guard';
  const image = {data: 'aW1hZ2U=', mimeType: 'image/png'};
  setDraft(sid, {value: 'keep', images: Array(10).fill(image)});
  const session = createFakeQueueSession(sid);
  session.enqueueFollowUp('one more', [image]);
  const {sendCommand, calls} = createRpcDispatcher(new Map([[sid, session]]));
  const result = await recallSessionQueue({sessionId: sid, sendCommand, restoreSubmission() { assert.fail('must not mutate draft'); }});
  assert.equal(result.recalled, false);
  assert.deepEqual(calls.map(c => c.command.type), ['get_queue_actions']);
  assert.equal(session.agent.followUpQueue.messages.length, 1);
  assert.equal(getDraft(sid).images.length, 10);
  clearDraft(sid);
});

test("delayed recall RPC race: growing draft images from 1 to 9 while recall_all_queued_messages is in flight preserves all 11 images and text", async () => {
  const sid = "async-capacity-race";
  clearDraft(sid);

  const makeImg = (idx) => ({
    data: Buffer.from(`race-img-${idx}`, "utf8").toString("base64"),
    mimeType: "image/png",
  });

  const initialDraftImg = makeImg(1);
  const addedDuringFlight = Array.from({ length: 8 }, (_, idx) => makeImg(idx + 2)); // 2..9
  const recalledImg1 = makeImg(10);
  const recalledImg2 = makeImg(11);

  setDraft(sid, {
    value: "original draft text",
    images: [initialDraftImg],
  });

  const session = createFakeQueueSession(sid);
  session.enqueueSteering("queued steering 1", [recalledImg1]);
  session.enqueueFollowUp("queued followup 2", [recalledImg2]);

  const { sendCommand } = createRpcDispatcher(new Map([[sid, session]]));

  const outcome = await recallSessionQueue({
    sessionId: sid,
    targetDraftKey: sid,
    sendCommand: async (sessionId, cmd) => {
      if (cmd.type === "recall_all_queued_messages") {
        // Simulate user adding 8 more images (total 9 <= 10) while RPC is in flight
        await new Promise((resolve) => setTimeout(resolve, 10));
        setDraft(sid, {
          value: "original draft text",
          images: [initialDraftImg, ...addedDuringFlight],
        });
      }
      return sendCommand(sessionId, cmd);
    },
    restoreSubmission(text, images, targetDraftKey) {
      restoreDraftSubmission(
        targetDraftKey,
        text,
        images?.map(({ data, mimeType }) => ({ data, mimeType })),
      );
    },
    isSameSession: () => true,
  });

  assert.equal(outcome.recalled, true);
  const finalDraft = getDraft(sid);
  assert.equal(
    finalDraft.value,
    "queued steering 1\n\nqueued followup 2\n\noriginal draft text",
  );
  assert.equal(finalDraft.images.length, 11);
  assert.deepEqual(finalDraft.images, [
    recalledImg1,
    recalledImg2,
    initialDraftImg,
    ...addedDuringFlight,
  ]);

  clearDraft(sid);
});

test("invalid base64 cannot be drained and then rejected by the destination composer", () => {
  const session = createFakeQueueSession('invalid-image');
  const message = session.enqueueFollowUp('retain invalid attachment', [{data:'aW1hZ2U=', mimeType:'image/png'}]);
  const token = queueActions.snapshot(session).followUp[0].token;
  message.content[1].data = 'not-valid-base64!';
  assert.throws(() => queueActions.recallAll(session, [token]), /attachment schema/);
  assert.equal(session.agent.followUpQueue.messages.length, 1);
  assert.equal(session._followUpMessages.length, 1);
  assert.equal(session.emitCount, 0);
});

test("useAgentSession.ts handleRecallQueue delegates to recallSessionQueue and does not use clear_queue", async () => {
  const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const start = hookSource.indexOf("const handleRecallQueue =");
  assert.notEqual(start, -1, "handleRecallQueue must exist in hooks/useAgentSession.ts");
  const nextHandler = hookSource.indexOf("const handleThinkingLevelChange =", start);
  const block = hookSource.slice(start, nextHandler);

  assert.match(block, /recallSessionQueue\(/);
  assert.doesNotMatch(block, /clear_queue/);
  assert.doesNotMatch(block, /prependText/);

  // Direct unit checks for helper validators
  assert.throws(() => extractSnapshotTokens({ version: 1, steering: [], followUp: [] }));
  assert.throws(() => validateRecallAllResponse({ version: 2, entries: [] }, ["tok-1"]));
  assert.deepEqual(mergeRecalledQueueEntries([]), { text: "", images: [] });
});
