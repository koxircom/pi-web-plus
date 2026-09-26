# Release Checklist

Pi Web Standalone Edition releases are distributed exclusively through [`koxircom/pi-web-standalone` GitHub Releases](https://github.com/koxircom/pi-web-standalone/releases):

- GitHub Release tag: `v<version>` in `koxircom/pi-web-standalone` (for example, planned release `v1.0.2`)
- Release tarball asset: `pi-web-standalone-<version>.tgz` (for example, `pi-web-standalone-1.0.2.tgz`)
- Official install command (replace `<version>` when targeting another release):
  ```bash
  npm install -g https://github.com/koxircom/pi-web-standalone/releases/download/v1.0.2/pi-web-standalone-1.0.2.tgz
  ```

> **Release Invariants**:
> - `package.json` keeps `"name": "@agegr/pi-web"` (alongside `"piWebEdition": "koxir-standalone"` and `"standalone": true`) for internal runtime compatibility, but **never publish to or pull from the public npm registry**.
> - **Pushing `main` alone is not a release**: every release must complete all 5 steps below — preflight & version preparation, offline build + `npm pack` + tarball verification, clean install verification, GitHub Release asset upload + `Latest` verification, and running-instance synchronization.

Use this 5-step checklist from a clean `main` checkout with Node.js `>=22.19.0`.

## 1. Preflight & Version Preparation

Verify Node.js (`node >=22.19`), repository state, GitHub CLI authentication, package metadata, and quality checks:

```bash
node --version
git status --short --branch
git log --oneline --decorate -5
gh auth status
node -e "const p=require('./package.json'); console.log(p.name, p.version, p.piWebEdition, p.standalone)"
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected:

- Node.js is `22.19.0` or newer (`>=22.19.0`).
- `git status` is clean, or only contains the intentional version bump (`package.json` and `package-lock.json`, e.g. `1.0.2`).
- `package.json` retains `"name": "@agegr/pi-web"`, `"piWebEdition": "koxir-standalone"`, and `"standalone": true`.
- GitHub CLI is authenticated with write/release access to `koxircom/pi-web-standalone`.

## 2. Offline Build, `npm pack`, and Tarball Verification

Run the production build and pack the standalone tarball locally. Do not run `next build` during normal development; release packaging is the exception.

```bash
VERSION=$(node -p "require('./package.json').version")
npm run build
PACK_FILE=$(npm pack)
mv "$PACK_FILE" "pi-web-standalone-${VERSION}.tgz"
ls -lh "pi-web-standalone-${VERSION}.tgz"
```

Inspect the archive to verify that required runtime files are included and development/cache artifacts are excluded:

```bash
tar -ztvf "pi-web-standalone-${VERSION}.tgz" | head -n 40
tar -ztf "pi-web-standalone-${VERSION}.tgz" | rg "^package/(bin/pi-web\.js|package\.json|\.next/BUILD_ID|public/)"
! tar -ztf "pi-web-standalone-${VERSION}.tgz" | rg "^package/\.next/(cache|dev)/|\.js\.map$"
```

## 3. Clean Install Verification

Before tagging or uploading the release asset, verify that `pi-web-standalone-${VERSION}.tgz` installs cleanly into an isolated prefix and that the `pi-web` CLI entrypoint works:

```bash
TMP_PREFIX=$(mktemp -d)
npm install -g --prefix "$TMP_PREFIX" "./pi-web-standalone-${VERSION}.tgz"
"$TMP_PREFIX/bin/pi-web" --help
rm -rf "$TMP_PREFIX"
```

## 4. Commit, Tag, Upload GitHub Release Asset, and Verify `Latest`

Commit the version bump (if not already committed), create the annotated `v<version>` tag, and push `main` and tags to `koxircom/pi-web-standalone`:

```bash
git diff -- package.json package-lock.json
git add package.json package-lock.json
git commit -m "Release v${VERSION}"
git tag -a "v${VERSION}" -m "v${VERSION}"
git push origin main --tags
```

Prepare bilingual (Chinese and English) release notes from the commit range `v<previous>..v${VERSION}`:

```bash
git log --oneline --decorate "v<previous>..v${VERSION}"
git diff --stat "v<previous>..v${VERSION}"
```

Create the GitHub Release on `koxircom/pi-web-standalone`, attach `pi-web-standalone-${VERSION}.tgz`, and mark it as `Latest` (required because `/api/app-update` checks `releases/latest`):

```bash
gh release create "v${VERSION}" \
  "./pi-web-standalone-${VERSION}.tgz#pi-web-standalone-${VERSION}.tgz" \
  --repo koxircom/pi-web-standalone \
  --verify-tag \
  --latest \
  --title "v${VERSION}" \
  --notes-file release-notes.md
```

Verify the published release metadata, asset URL, and `isLatest: true` status:

```bash
gh release view "v${VERSION}" \
  --repo koxircom/pi-web-standalone \
  --json tagName,isDraft,assets,url
gh api repos/koxircom/pi-web-standalone/releases/latest --jq '.tag_name'
```

Expected:

- `isDraft` is `false`, and the `/releases/latest` API returns `v${VERSION}`.
- `assets` contains `pi-web-standalone-${VERSION}.tgz` with download URL `https://github.com/koxircom/pi-web-standalone/releases/download/v${VERSION}/pi-web-standalone-${VERSION}.tgz`.

## 5. Synchronize Running Instances

Pushing `main` or publishing a GitHub Release does **not** automatically update running Pi Web environments. After verifying the release asset and `Latest` status, upgrade target running instances from the official GitHub Release tarball (for example, `v1.0.2`):

```bash
npm install -g "https://github.com/koxircom/pi-web-standalone/releases/download/v${VERSION}/pi-web-standalone-${VERSION}.tgz"
```

After installation:

- Verify the installed `package.json` reports `"version": "${VERSION}"`, `"piWebEdition": "koxir-standalone"`, and `"standalone": true`.
- Restart or reload the target service following the environment's maintenance protocol and confirm `/login` (HTTP 200) and version status.
- Remove the local temporary `pi-web-standalone-${VERSION}.tgz` artifact from the working tree so `git status` remains clean.
