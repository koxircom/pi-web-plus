/** Stable/prerelease SemVer comparison shared by version badges, without server imports. */
export function isNewerReleaseVersion(latest: string, installed: string): boolean {
  const parse = (value: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match) return null;
    const parts = match.slice(1, 4).map(Number);
    if (parts.some(n => !Number.isSafeInteger(n))) return null;
    return { parts, pre: match[4]?.split(".") ?? [] };
  };
  const a = parse(latest), b = parse(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  if (!a.pre.length || !b.pre.length) return !a.pre.length && !!b.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return false;
    if (b.pre[i] === undefined) return true;
    if (a.pre[i] === b.pre[i]) continue;
    const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) return Number(a.pre[i]) > Number(b.pre[i]);
    if (an !== bn) return !an;
    return a.pre[i] > b.pre[i];
  }
  return false;
}
