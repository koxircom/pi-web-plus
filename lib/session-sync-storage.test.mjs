import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareSessionWireDisk} from './session-sync-storage.ts';

test('canonical persistent record shares one history and one serialization with byte accounting', () => {
  let serializations = 0;
  const messages = [{role:'user', toJSON(){ serializations++; return {role:'user',content:'中文'.repeat(1000)}; }}];
  const entryIds = ['e1'];
  const baseline = Object.freeze({sessionId:'s1', revision:'r1', savedAt:Date.now(), messages, entryIds,
    data:{sessionId:'s1', snapshotRevision:'r1',context:{messages,entryIds},tools:{readonly:true}}});
  const record = prepareSessionWireDisk(baseline);
  assert(record); assert.equal(record.format,2); assert.equal(serializations,1);
  assert.equal(prepareSessionWireDisk(baseline),record); assert.equal(serializations,1);
  const packed = JSON.parse(record.json);
  assert.equal(packed.messages,undefined); assert.equal(packed.entryIds,undefined);
  assert.deepEqual(packed.data.context.entryIds,['e1']); assert.deepEqual(packed.data.tools,{readonly:true});
  assert.equal(record.bytes,new TextEncoder().encode(record.json).byteLength);
});
test('noncanonical and circular snapshots fail closed without changing the caller',()=>{
 const messages=[],entryIds=[];
 assert.equal(prepareSessionWireDisk({sessionId:'s',messages,entryIds}),null);
 const data={context:{messages,entryIds}};
 assert.equal(prepareSessionWireDisk({data,messages:[],entryIds}),null);
 data.self=data;
 assert.equal(prepareSessionWireDisk({data,messages,entryIds}),null);
 assert.equal(data.self,data);
});
