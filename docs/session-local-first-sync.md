# Local-first session synchronization — implementation contract

Status: SOURCE IMPLEMENTED AND ISOLATION-VERIFIED; BACKEND NOT DEPLOYED (2026-09-25). Source checkout `/workspace/pi-web` (0.9.3) is NOT the installed 0.9.1 runtime. Do not restart/start Pi Web, overwrite running `.next/server`, or claim server deployment from source edits. Production session/config data must remain untouched. Existing unrelated changes in ChatMinimap and enhancements must be preserved.

## Scope / order
1. [done] Versioned read-only sync service and bounded delta protocol; keep legacy GET behavior unless `sync=1`.
2. [done] Native client coordinator and hook: cached history first, one negotiation, exact-base merges, stream-race guards, existing plugin toggle. Exact wire snapshots now have bounded IndexedDB backing for hard refresh.
3. [done] Isolated real route/protocol tests plus real-browser React-hook integration; HTTP-loaded compatibility script verified against embedded source.
4. [done] Independent diff review, typecheck, evidence below. [BLOCKED ON CONTROLLED RELEASE] New backend/native hook activation: must build/publish an approved package and have the user manually restart Pi Web. No running server bundle was overwritten. Persistent history *block/page* redesign and optional prefetch remain out of this first release.

## Wire contract (v1)
Use existing authenticated `GET /api/sessions/:id` with `sync=1` and optional `baseRevision=<opaque>`. Existing params (`tree=summary`, tail/defer flags, force) retain meaning. Canonical scope includes session identity and the actual projection params, not baseRevision/force. Protocol responses use `Cache-Control: private, no-store` and header `X-Pi-Session-Sync: 1`. No CORS/authentication changes, new port, or filesystem path accepted from clients.

Responses:
- `{protocol:1, mode:'unchanged', revision}`: exact base version + scope unchanged. No history/body recomputation. Client keeps its exact snapshot.
- `{protocol:1, mode:'reset', revision:string|null, data:SessionData}`: authoritative current window; null revision means not safe to cache as fresh (running/unstable). Empty authoritative reset is valid; never blanket-ignore explicit empty states.
- `{protocol:1, mode:'delta', baseRevision, revision, dropCount, keepCount, tailMessages, data:SessionDataWithoutContextMessages}`: new messages = base.context.messages.slice(dropCount, dropCount+keepCount).concat(tailMessages). data.context.entryIds is the complete resulting parallel array. Complete metadata/tree/context cursor comes from `data`, not from the old snapshot. Identical retained IDs AND canonical message content are required. Prefix shifts support a moving bounded history window. Branch/compaction/replacement incompatibility safely resets. If delta is not smaller than reset, reset is acceptable.

Opaque revision is not a hash ordering or permission. Scope includes protocol/projection version and server process generation so a process restart invalidates old bases. First-release safety decision: ALL live wrappers, even idle ones, return reset with null revision; fast unchanged/delta is only certified for stable disk-backed reads. A live atomic revision stamp has not been implemented or claimed. Use validated file fingerprint (device/inode/size/mtime/ctime) plus actual read-source identity/active leaf/entry count/latest entry. File stat is invalidation evidence, not an absolute proof under adversarial rewrites. Compare version before and after snapshot construction; unstable/running snapshots never qualify for unchanged/delta. Runtime fingerprint mismatch with disk must not certify a stale live wrapper. Reuse existing read-only SessionManager helpers; no AgentSession creation or writes. Gate unchanged before tree/context/stats construction. Use bounded server baseline LRU (count, byte size, TTL); evicted/unknown baselines reset. For process-local elapsed budgets/TTL prefer performance.now(), not wall-clock subtraction.

## Client invariants
- Sync feature is controlled by existing `session-memory-cache` enhancement plugin; no separate preference island. Disabled => native legacy request; no cached preview/sync attempt. If hook starts before enhancements, parse existing pi-enh-settings-v1 schema correctly or choose conservative legacy behavior.
- Server 0.9.1 may ignore sync query and return legacy JSON. Recognize absence of header/envelope and consume as legacy without failure or retry loops; never mistake an HTML/401/404 for a snapshot.
- Exact wire baselines are separate from wider user-paged view snapshots. Never attach a newer revision to stale messages. Content + revision stored together. Reuse unchanged message object references where possible.
- Keep confirmed history visible during network validation; network failure does not certify freshness or clear readable history. Authentication failure/404 must not resurrect cache. Do not cache running, queue or SSE state. Native wire backing uses origin-local IndexedDB `pi-enh-session-wire-v1`, max 8 snapshots / 32 MiB / 24-hour persisted age, separate from incompatible legacy v2 fetch payloads. Memory view and wire caches each have max 8 / 32 MiB. Disable/logout/delete invalidate queued writes; disk hydration does not refresh its persisted validation timestamp.
- Deduplicate same-scope sync requests. A session/request generation and activity epoch reject old responses after switch, newer force/read, send, SSE, navigation/compaction, or plugin disable. No timer/SSE connection takeover.
- Preserve paged-in history only when compatibility is actually proven. No arbitrary merge across branches. Do not shrink loaded history on unchanged response or overwrite wider cached view with the short wire window.
- Apply through React state (data, messages, entryIds, leaf/cursor/stats together); no direct unmanaged DOM appends.

## Acceptance
- No-change: one small sync response, zero tree/context/stats rebuild for warm stable snapshot.
- Same-ID text edit, tail append/replacement, moving window, profile mismatch, branch, compaction, file replace, cache eviction, empty reset, unstable snapshot, malformed patch tested.
- Browser: actual modified useAgentSession hook with real React; local preview before delayed network response, A/B/A, appended/changed text exactly once, unchanged object reuse/paged history, stale SSE/force race, disabled feature, legacy response, network failure. Fixtures and all writes isolated; no real task submission.
- Report measured evidence only; no 0ms/90% promises. Source/test completion is not installed-runtime activation.
