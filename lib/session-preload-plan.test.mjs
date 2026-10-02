import assert from "node:assert/strict";
import test from "node:test";
import { planSessionPreloads } from "./session-preload-plan.ts";

function candidate(sessionId, overrides = {}) {
	return {
		sessionId,
		attentionPending: false,
		running: false,
		completedUnread: false,
		recentlyAccessed: false,
		recencyRank: Number.POSITIVE_INFINITY,
		...overrides,
	};
}

test("keeps the active candidate in one of the bounded preload slots", () => {
	const inputs = [
		candidate("selected"),
		...Array.from({ length: 20 }, (_, index) => candidate(`ask-${index}`, {
			attentionPending: true,
			recencyRank: index,
		})),
	];
	const result = planSessionPreloads(inputs, { activeSessionId: "selected" });
	assert.equal(result.length, 20);
	assert.equal(result[0]?.sessionId, "selected");
	assert.equal(result[0]?.priority, "normal");
	assert.equal(result[1]?.sessionId, "ask-0");
	assert.equal(result.some((item) => item.sessionId === "ask-19"), false);
});

test("orders remaining slots by ask, running, completed-unread, then recency", () => {
	const inputs = [
		candidate("recent-1", { recentlyAccessed: true, recencyRank: 1 }),
		candidate("done", { completedUnread: true, recencyRank: 9 }),
		candidate("running", { running: true, recencyRank: 8 }),
		candidate("ask", { attentionPending: true, recencyRank: 7 }),
		candidate("recent-0", { recentlyAccessed: true, recencyRank: 0 }),
	];
	assert.deepEqual(
		planSessionPreloads(inputs).map((item) => item.sessionId),
		["ask", "running", "done", "recent-0", "recent-1"],
	);
});
