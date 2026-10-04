import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLocalSessions, pendingSessionInfo } from './session-catalog-client.ts';

test('a first submission has an immediate non-clickable row using its first message as title', () => {
  const row = pendingSessionInfo('new:draft:/fixture', '/fixture', undefined, '立即出现的标题');
  assert.equal(row.id, 'new:draft:/fixture');
  assert.equal(row.submissionPending, true);
  assert.equal(row.name, undefined);
  assert.equal(row.firstMessage, '立即出现的标题');
});
test('a stale empty list cannot erase a local first submission', () => {
  const row = pendingSessionInfo('draft', '/fixture');
  assert.deepEqual(mergeLocalSessions([], [row]), [row]);
});
test('a real id replaces the provisional id before preflight without selecting or remounting chat', () => {
  const row = pendingSessionInfo('draft', '/fixture', 'real');
  assert.equal(row.id, 'real');
  assert.equal(row.name, '图片消息');
  assert.equal(row.submissionPending, true);
});
test('canonical session metadata replaces a local accepted row exactly once', () => {
  const row = pendingSessionInfo('draft', '/fixture', 'real');
  const canonical = {...row, name:'即时反馈修复', transient:false, submissionPending:undefined};
  const other = {...canonical, id:'other'};
  assert.deepEqual(mergeLocalSessions([canonical, other], [row]), [canonical, other]);
});

test('an empty canonical row keeps the submitted title and canonical project identity',()=>{
 const row=pendingSessionInfo('draft','/fixture','real','首条消息');
 const server={...row,name:undefined,firstMessage:'',submissionPending:undefined,projectKey:'/repo',projectRoot:'/repo'};
 const [merged]=mergeLocalSessions([server],[row]);
 assert.equal(merged.firstMessage,'首条消息');
 assert.equal(merged.submissionPending,true);
 assert.equal(merged.projectKey,'/repo');
});
