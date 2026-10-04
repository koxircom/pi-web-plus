"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), vm = require("node:vm");
function buildOptionalAssets(enhancementsDir = __dirname, { write = false } = {}) {
  const output = path.join(enhancementsDir, "..", "public", "pi-web-assets");
  if (write) fs.mkdirSync(output, { recursive: true });
  const manifest = {};
  for (const [id, source] of [["xlsx-engine", "assets/xlsx-engine.js"], ["usage-panel", "pi-usage-panel.js"], ["image-editor", "assets/image-editor.js"]]) {
    const raw = fs.readFileSync(path.join(enhancementsDir, source));
    const bytes = id === "image-editor" ? Buffer.from(require("esbuild").transformSync(raw.toString("utf8"), {
      loader: "js", target: "es2020", minifyWhitespace: true, minifySyntax: true, legalComments: "eof",
    }).code) : raw;
    new vm.Script(bytes.toString("utf8"), { filename: source });
    const hash = crypto.createHash("sha256").update(bytes).digest();
    const name = `${id}-${hash.toString("hex").slice(0, 16)}.js`;
    const target = path.join(output, name);
    if (write) fs.writeFileSync(target, bytes);
    else if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) throw new Error(`可选组件资源未构建或已漂移：${name}`);
    manifest[id] = { path: `/pi-web-assets/${name}`, integrity: `sha256-${hash.toString("base64")}`, bytes: bytes.length };
  }
  const loader = fs.readFileSync(path.join(enhancementsDir, "lazy-assets.js"), "utf8");
  if (loader.split("__PI_OPTIONAL_ASSET_MANIFEST__").length !== 2) throw new Error("可选组件资源清单占位符必须唯一");
  const script = loader.replace("__PI_OPTIONAL_ASSET_MANIFEST__", JSON.stringify(manifest));
  new vm.Script(script, { filename: "lazy-assets.js" });
  return { script, manifest };
}
module.exports = { buildOptionalAssets };
