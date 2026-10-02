import test from 'node:test';import assert from 'node:assert/strict';import {selectSessionReadRuntime,isSessionReadStable} from './session-read-source.ts';
test('idle retained runtime reads stable disk, while starting or replacing a writer invalidates the read',()=>{
 let running=false;const idle={isAlive:()=>true,isRunning:()=>running};const other={isAlive:()=>true,isRunning:()=>false};
 assert.equal(selectSessionReadRuntime(idle),undefined);assert(isSessionReadStable(idle,idle));
 running=true;assert.equal(selectSessionReadRuntime(idle),idle);assert.equal(isSessionReadStable(idle,idle),false);
 running=false;assert.equal(isSessionReadStable(idle,other),false);assert.equal(isSessionReadStable(undefined,other),false);assert(isSessionReadStable(idle,undefined));
});
