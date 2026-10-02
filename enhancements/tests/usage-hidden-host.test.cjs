'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../modules/08-settings-panels-and-lifecycle.js'),'utf8');
const condition=source.match(/if \((panel.isConnected &&[^\n]+)\) \{\n        renderUsagePanel/)[1];
test('deferred usage render skips hidden, replaced, or detached native settings hosts',()=>{
 const view={};for(const state of [{connected:true,hidden:false,same:true,expected:true},{connected:true,hidden:true,same:true,expected:false},{connected:false,hidden:false,same:true,expected:false},{connected:true,hidden:false,same:false,expected:false}]){
 const panel={isConnected:state.connected,firstElementChild:state.same?view:{},closest:()=>state.hidden?{}:null};
 assert.equal(vm.runInNewContext(condition,{panel,loadingView:view,isPluginEnabled:()=>true}),state.expected);
 }
});
