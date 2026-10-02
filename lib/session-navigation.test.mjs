import test from "node:test";
import assert from "node:assert/strict";
import { replaceSessionUrl } from "./session-navigation.ts";
test("promotion replaces cwd with session without a route navigation", () => {
 const calls=[];globalThis.window={location:new URL("http://localhost/?cwd=%2Fwork"),history:{replaceState:(...args)=>calls.push(args)}};
 try {replaceSessionUrl("?session=owned");assert.deepEqual(calls,[[null,"","/?session=owned"]]);} finally {delete globalThis.window;}
});
test("same session is a no-op and foreign pages fail closed", () => {
 const calls=[];globalThis.window={location:new URL("http://localhost/?session=owned"),history:{replaceState:(...args)=>calls.push(args)}};
 try {replaceSessionUrl("?session=owned");assert.equal(calls.length,0);assert.throws(()=>replaceSessionUrl("/other"));assert.throws(()=>replaceSessionUrl("http://remote/?session=owned"));} finally {delete globalThis.window;}
});
