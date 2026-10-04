'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../modules/05-composer-and-input-workflow.js'), 'utf8');
const start = source.indexOf('  let imageEditorOpenGeneration = 0;');
const end = source.indexOf('  function syncComposerImageZoom()', start);
function harness() {
  const pending = [], opened = [], errors = [], listeners = new Set();
  const factory = { create(deps) { return (...args) => { deps.closeComposerImageZoomModal(); opened.push(args); }; } };
  const context = {
    window: { __PI_OPTIONAL_LOADED_ASSETS__: new Map(), __PI_ENH_LOAD_OPTIONAL__: () => new Promise((resolve,reject) => pending.push({resolve,reject})) },
    document: { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn), body: {style:{}} },
    showToast: value => errors.push(value),
    HISTORY_IMAGE_FAST_PATH_MAX_BYTES: 1, HISTORY_IMAGE_MAX_BYTES: 2,
    appendComposerImageState(){}, isMobileEnvironment(){}, parseHistoryImageDataUrl(){}, readBlobAsDataUrl(){}, readNativeComposerDraft(){}, replaceComposerImageState(){},
  };
  vm.createContext(context);
  vm.runInContext('let isDisposed=false,activeZoomDialog=null;\n'+source.slice(start,end)+'\nglobalThis.api={open:openComposerImageZoomModal,close:closeComposerImageZoomModal,dispose(){isDisposed=true;closeComposerImageZoomModal();}};',context);
  return {...context,pending,opened,errors,listeners,factory};
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); }
test('cancelled, disposed and superseded image loads cannot reopen a dialog; warm actions stay synchronous', async () => {
  const h=harness();h.api.open('one');h.api.close();h.pending.shift().resolve(h.factory);await settle();assert.equal(h.opened.length,0);assert.equal(h.listeners.size,0);
  h.api.open('older');h.api.open('newer');h.pending.shift().resolve(h.factory);h.window.__PI_OPTIONAL_LOADED_ASSETS__.set('image-editor',{value:h.factory});h.pending.shift().resolve(h.factory);await settle();assert.equal(h.opened.length,1);assert.equal(h.opened[0][0],'newer');
  h.api.open('warm');assert.equal(h.opened.length,2);assert.equal(h.pending.length,0);
  const d=harness();d.api.open('disposed');d.api.dispose();d.pending.shift().resolve(d.factory);await settle();assert.equal(d.opened.length,0);assert.equal(d.listeners.size,0);
});
test('loading failures preserve the action for retry and clean temporary Escape listeners', async () => {
  const h=harness();h.api.open('retry');h.pending.shift().reject(new Error('network'));await settle();assert.equal(h.errors.length,1);assert.equal(h.listeners.size,0);
  h.api.open('retry');h.pending.shift().resolve(h.factory);await settle();assert.equal(h.opened.length,1);
});

test('Escape cancels a pending image action without reaching composer stop, and IME Escape is untouched', async () => {
  const h=harness();h.api.open('escape');let prevented=0,stopped=0;
  const cancel=[...h.listeners][0];cancel({key:'Escape',isComposing:true,preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(prevented,0);
  cancel({key:'Escape',isComposing:false,preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(prevented,1);assert.equal(stopped,1);
  h.pending.shift().resolve(h.factory);await settle();assert.equal(h.opened.length,0);assert.equal(h.listeners.size,0);
});
