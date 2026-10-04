/* Optional resources share one request and publish no UI ownership. */
(function (root) {
  "use strict";
  const assets = __PI_OPTIONAL_ASSET_MANIFEST__;
  const pending = new Map();
  // Hot reloads may change an optional asset while keeping the same window.
  // Reuse only an export stamped with this exact content-addressed path.
  const versions = root.__PI_OPTIONAL_LOADED_ASSETS__ instanceof Map
    ? root.__PI_OPTIONAL_LOADED_ASSETS__ : (root.__PI_OPTIONAL_LOADED_ASSETS__ = new Map());
  function read(name, fromLoad = false) {
    let value = null;
    if (name === "xlsx-engine" && typeof root.XLSX?.read === "function") value = root.XLSX;
    if (name === "usage-panel" && typeof root.PiUsagePanel?.render === "function") value = root.PiUsagePanel;
    if (name === "image-editor" && typeof root.PiImageEditor?.create === "function") value = root.PiImageEditor;
    if (!value) return null;
    const path = assets[name]?.path;
    if (fromLoad) versions.set(name, { path, value });
    const loaded = versions.get(name);
    return loaded?.path === path && loaded.value === value ? value : null;
  }

  root.__PI_ENH_LOAD_OPTIONAL__ = function (name) {
    const asset = assets[name];
    if (!asset) return Promise.reject(new Error("未知的可选组件"));
    const loaded = read(name);
    if (loaded) return Promise.resolve(loaded);
    if (pending.has(name)) return pending.get(name);
    const promise = new Promise((resolve, reject) => {
      const script = root.document.createElement("script");
      script.src = asset.path;
      script.integrity = asset.integrity;
      script.async = true;
      script.dataset.piOptionalAsset = name;
      let timer;
      const finish = error => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        const value = error ? null : read(name, true);
        if (error || !value) {
          script.remove();
          reject(error || new Error("可选组件初始化失败"));
        } else {
          resolve(value);
        }
      };
      script.onload = () => finish();
      script.onerror = () => finish(new Error("可选组件加载失败，请重试"));
      timer = setTimeout(() => finish(new Error("可选组件加载超时，请重试")), 15000);
      root.document.head.appendChild(script);
    }).finally(() => pending.delete(name));
    pending.set(name, promise);
    return promise;
  };
})(window);
