// Bounded in-memory snapshot of one session's rendered view, so switching back
// to a recently visited session shows history immediately while a background
// freshness check runs.
//
// Constraints (deliberate):
// - Page-memory only. Never localStorage/IndexedDB/Service Worker, never sent
//   anywhere. Cleared by a full page reload by design.
// - LRU: at most MAX_SESSIONS sessions and MAX_TOTAL_BYTES serialized bytes;
//   oversize or error snapshots are simply not cached.
// - Only *settled history* is cached: the confirmed message window, entry ids,
//   active leaf, pagination cursor, summary tree, and display stats. Never
//   streaming state, queued messages, run state, or SSE objects.

import type { AgentMessage } from "./types";
import type { SessionData } from "../hooks/useAgentSession";
import { deleteSessionWireDisk, writeSessionWireDisk } from "./session-sync-storage.ts";

export interface SessionViewSnapshot {
	sessionId: string;
	/** Opaque server revision the snapshot was validated against. */
	revision: string;
	messages: AgentMessage[];
	entryIds: string[];
	leafId: string | null;
	/** Oldest entry id currently loaded — the pagination cursor. */
	oldestEntryId: string | null;
	hasMore: boolean;
	/** Summary-format branch tree (no bodies) when the server sent one. */
	summaryTree?: unknown;
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
	stats?: unknown;
	totalActiveMs?: number;
	/** Ids of history pages the user already paged in beyond the first window. */
	loadedEntryIds: string[];
	savedAt: number;
}

/** Exact wire baseline returned by server for sync protocol delta calculation. */
export interface SessionWireBaseline {
	sessionId: string;
	revision: string;
	messages: AgentMessage[];
	entryIds: string[];
	/** Exact response metadata; unchanged cannot reconstruct tool presets from messages alone. */
	data?: SessionData;
	savedAt: number;
}

const MAX_SESSIONS = 8;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const TTL_MS = 10 * 60_000;

declare global {
	var __piSessionViewCache: Map<string, SessionViewSnapshot> | undefined;
	var __piSessionWireBaselines: Map<string, SessionWireBaseline> | undefined;
}

function cache(): Map<string, SessionViewSnapshot> {
	if (!globalThis.__piSessionViewCache) globalThis.__piSessionViewCache = new Map();
	return globalThis.__piSessionViewCache;
}

function wireCache(): Map<string, SessionWireBaseline> {
	if (!globalThis.__piSessionWireBaselines) globalThis.__piSessionWireBaselines = new Map();
	return globalThis.__piSessionWireBaselines;
}

function snapshotBytes(snapshot: unknown): number {
	try {
		return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
	} catch {
		// Circular or non-serializable payload — treat as oversize.
		return Number.MAX_SAFE_INTEGER;
	}
}

function evictToFit(): void {
	const store = cache();
	while (store.size > MAX_SESSIONS) {
		const oldestKey = store.keys().next().value;
		if (oldestKey === undefined) break;
		store.delete(oldestKey);
	}
	let total = 0;
	for (const snapshot of store.values()) total += snapshotBytes(snapshot);
	while (total > MAX_TOTAL_BYTES && store.size > 0) {
		const oldestKey = store.keys().next().value;
		if (oldestKey === undefined) break;
		const removed = store.get(oldestKey);
		store.delete(oldestKey);
		if (removed) total -= snapshotBytes(removed);
	}
}

export function getSessionViewSnapshot(sessionId: string): SessionViewSnapshot | null {
	const snapshot = cache().get(sessionId);
	if (!snapshot) return null;
	if (Date.now() - snapshot.savedAt > TTL_MS) {
		cache().delete(sessionId);
		return null;
	}
	// LRU touch.
	cache().delete(sessionId);
	cache().set(sessionId, snapshot);
	return snapshot;
}

/** Store a snapshot; returns false when it was refused (oversize/invalid). */
export function setSessionViewSnapshot(snapshot: Omit<SessionViewSnapshot, "savedAt">): boolean {
	if (!snapshot.sessionId || !snapshot.revision) return false;
	const store = cache();
	store.delete(snapshot.sessionId);
	const entry: SessionViewSnapshot = { ...snapshot, savedAt: Date.now() };
	const bytes = snapshotBytes(entry);
	if (bytes > MAX_TOTAL_BYTES) return false;
	store.set(entry.sessionId, entry);
	evictToFit();
	return cache().has(entry.sessionId);
}

export function deleteSessionViewSnapshot(sessionId: string): void {
	cache().delete(sessionId);
	wireCache().delete(sessionId);
	deleteSessionWireDisk(sessionId);
}

export function clearSessionViewCache(): void {
	cache().clear();
	wireCache().clear();
	deleteSessionWireDisk();
}

export function getSessionWireBaseline(sessionId: string): SessionWireBaseline | null {
	const baseline = wireCache().get(sessionId);
	if (!baseline) return null;
	if (Date.now() - baseline.savedAt > TTL_MS) {
		wireCache().delete(sessionId);
		return null;
	}
	// LRU touch
	wireCache().delete(sessionId);
	wireCache().set(sessionId, baseline);
	return baseline;
}

export function setSessionWireBaseline(baseline: Omit<SessionWireBaseline, "savedAt">, persist = true): boolean {
	if (!baseline.sessionId || !baseline.revision) return false;
	const store = wireCache();
	store.delete(baseline.sessionId);
	if (baseline.messages.length !== baseline.entryIds.length || new Set(baseline.entryIds).size !== baseline.entryIds.length) return false;
	const entry: SessionWireBaseline = { ...baseline, savedAt: Date.now() };
	if (snapshotBytes(entry) > MAX_TOTAL_BYTES) return false;
	store.set(entry.sessionId, entry);
	let totalBytes = Array.from(store.values()).reduce((sum, item) => sum + snapshotBytes(item), 0);
	while (store.size > MAX_SESSIONS || totalBytes > MAX_TOTAL_BYTES) {
		const oldestKey = store.keys().next().value;
		if (oldestKey === undefined) break;
		totalBytes -= snapshotBytes(store.get(oldestKey));
		store.delete(oldestKey);
	}
	if (persist && store.has(entry.sessionId)) writeSessionWireDisk(entry);
	return store.has(entry.sessionId);
}

export function deleteSessionWireBaseline(sessionId: string): void {
	wireCache().delete(sessionId);
	deleteSessionWireDisk(sessionId);
}

/** True when a cached window still covers every entry the UI has loaded. */
export function snapshotCoversLoadedEntries(
	snapshot: SessionViewSnapshot,
	loadedEntryIds: string[],
): boolean {
	if (loadedEntryIds.length === 0) return true;
	const known = new Set([...snapshot.entryIds, ...snapshot.loadedEntryIds]);
	return loadedEntryIds.every((id) => known.has(id));
}

/** Test seam: drop all module state. */
export function resetSessionViewCacheForTests(): void {
	globalThis.__piSessionViewCache = undefined;
	globalThis.__piSessionWireBaselines = undefined;
}
