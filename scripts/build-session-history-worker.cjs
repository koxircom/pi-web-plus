const esbuild = require("esbuild");
const path = require("path");

function buildWorker() {
  const rootDir = path.resolve(__dirname, "..");
  const entryPoint = path.join(rootDir, "lib", "session-history-worker-entry.ts");
  const outfile = path.join(rootDir, "bin", "session-history-worker.cjs");

  esbuild.buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile,
    sourcemap: false,
    external: [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-tui",
    ],
  });

  console.log(`[build-session-history-worker] Built ${outfile}`);
}

if (require.main === module) {
  buildWorker();
}

module.exports = { buildWorker };
