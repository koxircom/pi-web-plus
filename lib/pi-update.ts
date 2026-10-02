export interface PiAgentReleaseStatus {
  latestVersion: string | null;
  releaseUrl: string | null;
}

interface PiAgentReleaseCache {
  value?: PiAgentReleaseStatus;
  expiresAt: number;
  retryAfter: number;
  inFlight?: Promise<PiAgentReleaseStatus>;
}

interface PiAgentReleaseCheckerOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  successTtlMs?: number;
  failureBackoffMs?: number;
}

const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/earendil-works/pi/releases/latest";
const GITHUB_RELEASES_URL = "https://github.com/earendil-works/pi/releases/tag";
const FETCH_TIMEOUT_MS = 4_000;
const SUCCESS_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const PI_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const UNAVAILABLE: PiAgentReleaseStatus = Object.freeze({ latestVersion: null, releaseUrl: null });

declare global {
  // Keep one checker across Next.js development hot reloads and route-module instances.
  var __piAgentReleaseChecker: (() => Promise<PiAgentReleaseStatus>) | undefined;
}

function statusFromTag(tagName: unknown): PiAgentReleaseStatus | null {
  if (typeof tagName !== "string") return null;
  const version = tagName.startsWith("v") ? tagName.slice(1) : tagName;
  if (!PI_VERSION_PATTERN.test(version)) return null;

  return {
    latestVersion: version,
    releaseUrl: `${GITHUB_RELEASES_URL}/${encodeURIComponent(tagName)}`,
  };
}

async function fetchLatestRelease(fetchImpl: typeof fetch): Promise<PiAgentReleaseStatus> {
  const response = await fetchImpl(GITHUB_LATEST_RELEASE_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "pi-web-standalone-pi-update-check",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);

  const body = await response.json() as { tag_name?: unknown };
  const status = statusFromTag(body.tag_name);
  if (!status) throw new Error("GitHub Releases returned an invalid Pi Agent tag");
  return status;
}

export function createPiAgentReleaseChecker({
  fetchImpl = fetch,
  now = Date.now,
  successTtlMs = SUCCESS_TTL_MS,
  failureBackoffMs = FAILURE_BACKOFF_MS,
}: PiAgentReleaseCheckerOptions = {}): () => Promise<PiAgentReleaseStatus> {
  const cache: PiAgentReleaseCache = { expiresAt: 0, retryAfter: 0 };

  return async function getLatestPiAgentRelease(): Promise<PiAgentReleaseStatus> {
    const currentTime = now();
    if (cache.value && cache.expiresAt > currentTime) return cache.value;
    if (cache.inFlight) return cache.inFlight;
    if (cache.retryAfter > currentTime) return UNAVAILABLE;

    cache.inFlight = fetchLatestRelease(fetchImpl).then((status) => {
      cache.value = status;
      cache.expiresAt = now() + successTtlMs;
      cache.retryAfter = 0;
      return status;
    }).catch(() => {
      cache.retryAfter = now() + failureBackoffMs;
      return UNAVAILABLE;
    }).finally(() => {
      cache.inFlight = undefined;
    });

    return cache.inFlight;
  };
}

export function getLatestPiAgentRelease(): Promise<PiAgentReleaseStatus> {
  globalThis.__piAgentReleaseChecker ??= createPiAgentReleaseChecker();
  return globalThis.__piAgentReleaseChecker();
}
