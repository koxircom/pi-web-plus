interface SessionReadRuntime { isAlive(): boolean; isRunning(): boolean; }
/** Only an active writer owns the history read; idle retained runtimes use disk. */
export function selectSessionReadRuntime<T extends SessionReadRuntime>(runtime: T | null | undefined): T | undefined {
  return runtime?.isAlive() && runtime.isRunning() ? runtime : undefined;
}
/** A new writer/runtime during the disk read invalidates its revision commitment. */
export function isSessionReadStable(initial: SessionReadRuntime | null | undefined, current: SessionReadRuntime | null | undefined): boolean {
  return !current?.isRunning() && (!current?.isAlive() || current === initial);
}
