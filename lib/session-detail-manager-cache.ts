export interface SessionDetailManagerCacheOptions {
  maxEntries: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

interface CachedManager<T> {
  fingerprint: string;
  bytes: number;
  manager: T;
}

/** Small read-only LRU for one bounded history Worker. */
export class SessionDetailManagerCache<T> {
  private readonly entries = new Map<string, CachedManager<T>>();
  private totalBytes = 0;

  constructor(private readonly limits: SessionDetailManagerCacheOptions) {}

  public get(filePath: string, fingerprint: string, bytes: number): T | undefined {
    const cached = this.entries.get(filePath);
    if (!cached) return undefined;
    if (cached.fingerprint !== fingerprint || cached.bytes !== bytes) {
      this.delete(filePath);
      return undefined;
    }
    this.entries.delete(filePath);
    this.entries.set(filePath, cached);
    return cached.manager;
  }

  public set(filePath: string, fingerprint: string, bytes: number, manager: T): void {
    this.delete(filePath);
    if (
      !Number.isFinite(bytes) || bytes < 0 ||
      bytes > this.limits.maxFileBytes || bytes > this.limits.maxTotalBytes ||
      this.limits.maxEntries <= 0 || this.limits.maxTotalBytes <= 0
    ) {
      return;
    }

    this.entries.set(filePath, { fingerprint, bytes, manager });
    this.totalBytes += bytes;
    while (this.entries.size > this.limits.maxEntries || this.totalBytes > this.limits.maxTotalBytes) {
      const oldestPath = this.entries.keys().next().value;
      if (oldestPath === undefined) break;
      this.delete(oldestPath);
    }
  }

  public delete(filePath: string): void {
    const cached = this.entries.get(filePath);
    if (!cached) return;
    this.entries.delete(filePath);
    this.totalBytes -= cached.bytes;
  }

  public getSize(): number {
    return this.entries.size;
  }

  public getTotalBytes(): number {
    return this.totalBytes;
  }
}
