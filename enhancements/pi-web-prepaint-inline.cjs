"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const {
  extractEnhancementMetadata,
  buildFastPluginReaderSnippet,
  decodeTemplateLiteralEscapes,
} = require("./pi-web-settings-prepaint.cjs");

const START = "/* PI_WEB_SETTINGS_PREPAINT_BEGIN */";
const END = "/* PI_WEB_SETTINGS_PREPAINT_END */";

function buildBootstrap(modulesDir, options = {}) {
  const dir = modulesDir || path.join(__dirname, "enhancements", "modules");
  // Consumption targets use the validated release bundle, never stale development modules.
  const source = options.bundlePath;
  const metadata = extractEnhancementMetadata(source || path.join(dir, "02-plugin-registry-and-settings-schema.js"));
  // Native React/static CSS own composer startup; the loader contains no composer CSS.

  const code = `${START}\n;(function(){
    if(typeof window === "undefined" || typeof document === "undefined" || window.__PI_WEB_ENHANCEMENTS_LOADED__ || window.__PI_ENH_PREPAINT_REGISTERED__) return;
    window.__PI_ENH_PREPAINT_REGISTERED__ = true;
    ${buildFastPluginReaderSnippet(metadata)}
    window.__PI_ENH_IS_PLUGIN_ENABLED__ = window.__PI_ENH_IS_PLUGIN_ENABLED__ || isPluginFastActive;
  })();\n${END}\n`;
  new vm.Script(code, { filename: "settings-prepaint-bootstrap.js" });
  return code;
}

function stripPrefix(content) {
  const a = content.indexOf(START), b = content.indexOf(END);
  if(a === -1 && b === -1) return content;
  if(a !== 0 || b < START.length || content.indexOf(START, a+START.length) !== -1 || content.indexOf(END, b+END.length) !== -1) {
    throw new Error("[prepaint-inline] Invalid bounded prefix; refusing to alter native bootstrap");
  }
  return content.slice(b + END.length).replace(/^\r?\n/, "");
}

function replaceBoundedPrefix(content, bootstrap) {
  const native = stripPrefix(content);
  // Strictly recognize the small existing enhancement runtime, never rewrite native code.
  if(native.length > 128 * 1024 || !native.includes("__PI_WEB_LOADER_INJECTED__") || !native.includes("pi-web-enhancements-script") || !native.includes("/pi-web-enhancements.js")) {
    throw new Error("[prepaint-inline] Unrecognized native bootstrap; refused");
  }
  const next = bootstrap + native;
  new vm.Script(next, { filename: "layout-with-prepaint.js" });
  return { next, nativeSha256: crypto.createHash("sha256").update(native).digest("hex") };
}

function syncPrepaintInline(pkgDir, options = {}) {
  const dir = path.join(pkgDir, ".next", "static", "chunks", "app");
  const bootstrap = buildBootstrap(options.modulesDir || path.join(__dirname, "enhancements", "modules"), options);
  const report = { updated: [], unchanged: [], skipped: [] };
  if(!fs.existsSync(dir)) {
    if(options.required) throw new Error("[prepaint-inline] Client bootstrap directory missing");
    return report;
  }
  for(const name of fs.readdirSync(dir).filter(n => /^layout-[a-f0-9]+\.js$/.test(n))) {
    const target = path.join(dir, name), content = fs.readFileSync(target, "utf8"), native = stripPrefix(content);
    if(native.length > 128*1024 || !native.includes("__PI_WEB_LOADER_INJECTED__") || !native.includes("pi-web-enhancements-script") || !native.includes("/pi-web-enhancements.js")) {
      report.skipped.push(name); continue;
    }
    const { next, nativeSha256 } = replaceBoundedPrefix(content, bootstrap);
    if(next === content) { report.unchanged.push({name,nativeSha256}); continue; }
    const tmp = target + ".prepaint-" + process.pid + ".tmp";
    try { fs.writeFileSync(tmp,next,"utf8");fs.renameSync(tmp,target); }
    finally { if(fs.existsSync(tmp))fs.unlinkSync(tmp); }
    report.updated.push({name,nativeSha256,bytes:Buffer.byteLength(next)});
  }
  if(options.required && report.updated.length + report.unchanged.length === 0) throw new Error("[prepaint-inline] No recognized native bootstrap; refused");
  return report;
}
module.exports = {
  START,
  END,
  buildBootstrap,
  stripPrefix,
  replaceBoundedPrefix,
  syncPrepaintInline,
  decodeTemplateLiteralEscapes
};
