"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const dir=path.resolve(__dirname,'../enhancements/modules');
const files=fs.readdirSync(dir).filter(n=>/^0[1-8]-.*\.js$/.test(n)).sort();
const modules=files.map(n=>fs.readFileSync(path.join(dir,n),'utf8'));
const source=modules.join('\n');
const root=path.resolve(__dirname,'..');
const retired=['syncCodexComposerLayout','removeCodexComposerLayout','syncRunningActionButtons','ensureComposerModelPillStyle','syncComposerModelPill','removeComposerModelPill','syncComposerPreloadHeightProperty','applyComposerCustomHeight','resetComposerCustomHeight','syncComposerResizableHeight','updateCardContentState'];
test('assembled enhancement source parses without executing any browser script',()=>{assert.equal(files.length,8);assert.doesNotThrow(()=>new vm.Script(source));});
test('retired layout/resize/pill symbols have no remaining definition, caller or cleanup',()=>{for(const name of retired)assert.doesNotMatch(source,new RegExp('\\b'+name+'\\b'),name);assert.doesNotMatch(source,/pi-enh-codex-composer-style|pi-enh-composer-model-pill-style/);});
test('existing attachment routing no longer styles or retags editor/action nodes',()=>{
 const sf=ts.createSourceFile('05.js',modules[4],99,true,ts.ScriptKind.JS);
 const fn=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='syncComposerAttachmentSendability');assert.ok(fn);
 assert.doesNotMatch(fn.getText(sf),/classList|\.style\.|replaceChild|insertBefore|setProperty/);
 assert.match(fn.getText(sf),/pendingComposerAttachments/);assert.match(fn.getText(sf),/EMPTY_SEND_CONTINUE_ATTR/);
});
test('native settings takeover has no retired switch, callback or React tree mutation',()=>{
 assert.doesNotMatch(source,/\bsyncSettingsDialogEnhancements\b/);
 assert.doesNotMatch(modules[1],/settings-sidebar-layout|pi-enh-dashboard-shell|generalPanel\.appendChild|tagsTab\.remove|hideUsagePanel/);
 assert.match(modules[1],/pi-native-composer-preferences-change/);
});
test('native layout no longer imports a generated Head/CSS extraction workaround',()=>{
 const layout=fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8');assert.match(layout,/composer\.css/);assert.doesNotMatch(layout,/NativeComposerFirstPaint/);
 assert.equal(fs.existsSync(path.join(root,'components/NativeComposerFirstPaint.tsx')),false);
 const helper=fs.readFileSync(path.resolve(__dirname,'../enhancements/pi-web-prepaint-inline.cjs'),'utf8');assert.doesNotMatch(helper,/extractComposerCssTemplates|buildComposerPrepaintSnippet|extractFunctionStyleCss/);
});

test('native draft-store owns v3 persistence without legacy restore observers or sent flash effects',()=>{
 const component=fs.readFileSync(path.join(root,'components/ChatInput.tsx'),'utf8');
 const store=fs.readFileSync(path.join(root,'lib/draft-store.ts'),'utf8');
 assert.match(component,/getDraftInMemory/);assert.match(component,/draftHydratedKeyRef/);
 assert.match(store,/__PI_NATIVE_DRAFT_STORE__/);assert.match(store,/removePersistedDraft\(key\)/);
 assert.doesNotMatch(modules[4],/installNativeDraftRestoreObserver|scheduleDraftSubmissionObservation|draftSubmissionPollFrame|DRAFT_STORAGE_PREFIX|showSentPulseTransition|pi-enh-sent-indicator|pi-enh-sent-pulse/);
 assert.doesNotMatch(modules[4],/card\.after\(host\)|getComposerBelowHost|getNativeComposerToolbarControls|pi-enh-composer-below-host|host\.appendChild\(badge\)/);
 assert.doesNotMatch(modules[0],/pi-enh-sent-indicator|pi-enh-sent-pulse/);
});


test('session selection never force reloads current history and completion uses the sole native preloader',()=>{
 assert.equal(/sidebar_click_current|lastSessionIdBeforeClick/.test(source),false,"retired current-click refresh symbols");
 const sf=ts.createSourceFile('03.js',modules[2],99,true,ts.ScriptKind.JS);
 const fn=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='preloadCompletedSession');assert(fn);
 assert.match(fn.getText(sf),/scheduleCandidates/);assert.doesNotMatch(fn.getText(sf),/activeFetch|baseFetch|detailResp|preloadBridge\.preload|setTimeout/);
});
