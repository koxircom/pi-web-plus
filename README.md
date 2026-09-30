# Pi Web Standalone Edition

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Standalone local browser UI for the [pi coding agent](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`). Pi Web Standalone Edition shares the same local configuration and session files as pi, so you can browse and resume conversations, run agent turns, configure models and resources, and inspect project files from a browser.

> **Note**: Any third-party upstream static demo reflects the legacy upstream baseline rather than **Pi Web Standalone Edition** (which includes built-in enhancement plugins and standalone release distribution via [`koxircom/pi-web-standalone`](https://github.com/koxircom/pi-web-standalone)).

![Pi Web displaying a pi session with structured Markdown, tool calls, and project navigation](docs/screenshot2.png)

## Features

- **Session workspace**: browse, resume, rename, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Project file tools**: browse and upload files, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Git worktrees**: switch checkouts from the sidebar while keeping sessions from the same repository grouped together.
- **Web-based configuration**: manage provider login and API keys, models, model tests, plugin packages, and skills without leaving Pi Web.
- **English, Simplified Chinese, and Traditional Chinese UI**: Pi Web follows the browser language initially and provides a language switcher in the top bar.
- **Built-in Enhancement Plugins Suite**: Modular frontend plugins including session context menus, quick quote action bar, execution duration breakdown tooltip, Token/s speed monitoring, modern settings sidebar, and auto-folding tool cards (see [Enhancements Guide](./enhancements/README.md)).

## Quick Start

Pi Web Standalone requires Node.js 22.19.0 or newer (`node >=22.19`). Check your version with `node --version`, then install the prebuilt release tarball from [`koxircom/pi-web-standalone` GitHub Releases](https://github.com/koxircom/pi-web-standalone/releases) and start `pi-web`:

```bash
npm install -g https://github.com/koxircom/pi-web-standalone/releases/download/v1.1.0/pi-web-standalone-1.1.0.tgz
pi-web
```

> **Important**: The package name in `package.json` remains `@agegr/pi-web` for compatibility, but Pi Web Standalone is distributed exclusively through [`koxircom/pi-web-standalone` GitHub Releases](https://github.com/koxircom/pi-web-standalone/releases). Do **not** pull or install `@agegr/pi-web` from the public npm registry, as that would install the legacy upstream package instead of the Standalone Edition.

The CLI opens a browser after the server is ready. If it does not, open [http://127.0.0.1:30141](http://127.0.0.1:30141). Pi Web listens only on `127.0.0.1` by default.

If no model provider is configured yet, open the **Models** panel to sign in or add an API key.

The command above uses the `v1.1.0` release asset (`pi-web-standalone-1.1.0.tgz`) as the standard example. To install or upgrade to a specific release, stop the running process with `Ctrl+C`, replace both `v1.1.0` and `1.1.0` in the URL with the target `<version>` from [GitHub Releases](https://github.com/koxircom/pi-web-standalone/releases), and run the install command again:

```bash
npm install -g https://github.com/koxircom/pi-web-standalone/releases/download/v<version>/pi-web-standalone-<version>.tgz
```

- **SDK & Global CLI boundary**: Pi Web `v1.1.0` declares `@earendil-works/pi-*` SDK dependencies at `0.99.1` for the Web UI runtime. Installing or upgrading Pi Web does **not** automatically upgrade a separately installed global `pi` Agent CLI.
- **No bundled `node_modules` in `.tgz`**: The release tarball contains prebuilt `.next/` and static assets without `node_modules/`, so standard `npm install` dependency resolution is required (or reuse a verified matching `node_modules/` when staging offline).
- **Preserve instance data on upgrade**: When upgrading or unpacking over an existing deployment, protect custom static manifests (`public/pi-*-manifest.json`), local sessions (`~/.pi/agent/sessions/`), and usage ledgers (`pi-usage-ledger.json` / `~/.pi/agent/state/`) so default empty templates do not overwrite live user data.

To uninstall, run `npm uninstall -g @agegr/pi-web`.

## Configuration

For port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening. Run `pi-web --help` (or `-h`) to print startup options and exit without starting the server. Unknown options exit with an error.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--help`, `-h` | Print startup options and exit | — |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable Pi Web update checks | Unset |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable browser password login; API clients may use Basic Auth with username `pi` | Authentication disabled |
| `PI_WEB_IDLE_TIMEOUT_MS` | Session idle timeout in milliseconds, up to `2147483647`; `0` disables idle shutdown; invalid or out-of-range values use the default | `600000` (10 min) |

For example:

```bash
pi-web --help
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Password authentication does not encrypt the connection. Do not expose Pi Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Pi Web binds to.

### HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux (after installing the [GitHub Release tarball](https://github.com/koxircom/pi-web-standalone/releases/download/v1.1.0/pi-web-standalone-1.1.0.tgz)):

```bash
npm install -g https://github.com/koxircom/pi-web-standalone/releases/download/v1.1.0/pi-web-standalone-1.1.0.tgz
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
pi-web
```

On Windows PowerShell:

```powershell
npm install -g https://github.com/koxircom/pi-web-standalone/releases/download/v1.1.0/pi-web-standalone-1.1.0.tgz
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
pi-web
```

## Notes

- **Agent data**: Pi Web reads pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another pi agent directory.
- **Filesystem access**: Pi Web must be able to read the agent data directory and the working directories recorded by its sessions. Run Pi Web in the same filesystem environment as pi when sharing existing sessions.
- **Shared configuration**: the Models panel uses pi's model, settings, and credential storage, so changes are visible to both interfaces.
- **File access boundary**: the file browser is limited to working directories selected in Pi Web and project or session roots it already knows about; it is not a general filesystem browser.
- **Git worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for switcher visibility, worktree creation, and removal behavior.

### Downstream Session Context Menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, Pi Web preserves the
browser's native context menu. This hook is browser-side and independent of
Pi agent extensions.

### Extension Session Liveness

Server-side Pi extensions with detached work can prevent automatic idle
session eviction through the versioned global registry:

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

Register once per active extension session and call the returned idempotent
`release` function on session shutdown, replacement, or reload. `isActive`
must be synchronous, cheap, and scoped to the supplied exact session id or
file. Provider errors fail safe by preserving that session. This lease only
affects automatic idle eviction; explicit shutdown and Stop fallback cleanup
still take precedence.

## Development

```bash
npm install
npm run dev
```

The development server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141). Run the common checks with:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build` or `npm run build` during normal development. It writes to `.next/` and can interfere with the development server; leave builds for release work.

Contributor guides: [Internationalization](./docs/i18n.md) and [Release process](./docs/release.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint and launch option parsing
docs/            Focused user and contributor guides
demo/            Static browser demo published to GitHub Pages (see demo/README.md)
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## License

[MIT](./LICENSE)
