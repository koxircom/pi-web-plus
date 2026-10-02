import {
	MAX_SESSION_VIEW_CACHE_SESSIONS,
	type SessionViewCachePriority,
} from "./session-view-cache.ts";

/** Explicit status metadata supplied by the native preload coordinator. */
export interface SessionPreloadCandidate {
	sessionId: string;
	attentionPending: boolean;
	running: boolean;
	completedUnread: boolean;
	/** True only for sessions already resident in the canonical view cache. */
	recentlyAccessed: boolean;
	/** Lower ranks are more recent; obtained from getSessionViewCacheOrder(). */
	recencyRank: number;
}

export interface PlannedSessionPreload {
	sessionId: string;
	priority: SessionViewCachePriority;
}

export interface SessionPreloadPlanOptions {
	activeSessionId?: string | null;
	limit?: number;
}

function candidatePriority(candidate: SessionPreloadCandidate): SessionViewCachePriority | null {
	if (candidate.attentionPending) return "attention";
	if (candidate.running) return "running";
	if (candidate.completedUnread) return "completed-unread";
	if (candidate.recentlyAccessed) return "normal";
	return null;
}

function priorityRank(priority: SessionViewCachePriority): number {
	return priority === "attention" ? 3 : priority === "running" ? 2 : priority === "completed-unread" ? 1 : 0;
}

/**
 * Select at most the canonical cache capacity. Status is supplied by the
 * caller; this pure planner never infers notification or completion state.
 */
export function planSessionPreloads(
	candidates: readonly SessionPreloadCandidate[],
	options: SessionPreloadPlanOptions = {},
): PlannedSessionPreload[] {
	const activeSessionId = options.activeSessionId ?? null;
	const deduplicated = new Map<string, {
		priority: SessionViewCachePriority;
		recencyRank: number;
		firstIndex: number;
	}>();

	candidates.forEach((candidate, index) => {
		if (typeof candidate.sessionId !== "string" || !candidate.sessionId) return;
		const priority = candidatePriority(candidate)
			?? (candidate.sessionId === activeSessionId ? "normal" : null);
		if (!priority) return;
		const recencyRank = Number.isFinite(candidate.recencyRank) ? candidate.recencyRank : Number.POSITIVE_INFINITY;
		const current = deduplicated.get(candidate.sessionId);
		if (!current) {
			deduplicated.set(candidate.sessionId, { priority, recencyRank, firstIndex: index });
			return;
		}
		if (priorityRank(priority) > priorityRank(current.priority)) current.priority = priority;
		current.recencyRank = Math.min(current.recencyRank, recencyRank);
	});

	const planned = Array.from(deduplicated, ([sessionId, value]) => ({ sessionId, ...value }));
	planned.sort((a, b) =>
		Number(b.sessionId === activeSessionId) - Number(a.sessionId === activeSessionId)
		|| priorityRank(b.priority) - priorityRank(a.priority)
		|| a.recencyRank - b.recencyRank
		|| a.firstIndex - b.firstIndex,
	);

	const rawLimit = options.limit ?? MAX_SESSION_VIEW_CACHE_SESSIONS;
	const limit = Number.isFinite(rawLimit)
		? Math.min(MAX_SESSION_VIEW_CACHE_SESSIONS, Math.max(0, Math.floor(rawLimit)))
		: MAX_SESSION_VIEW_CACHE_SESSIONS;
	return planned.slice(0, limit).map(({ sessionId, priority }) => ({ sessionId, priority }));
}
