import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./modules/05-composer-and-input-workflow.js',import.meta.url),'utf8');
const extract=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const parse=vm.runInNewContext(extract('  function parseSubmittedComposerAttachments','  function restoreSubmittedComposerAttachments')+'\nparseSubmittedComposerAttachments',{TextEncoder,extractOriginalFilename:p=>p.split('/').at(-1),getMimeTypeFromExt:()=> 'application/octet-stream'});
test('historical mixed text and uploaded files restore cards with unchanged payload',()=>{
 const payload='请修改\n\n### `说明.txt`\n```text\n文件内容\n```\n\n\n[附件: @.pi-uploads/report.pdf]';
 const result=parse(payload);assert.equal(result.text,'请修改');assert.equal(result.attachments.length,2);
 assert.equal(result.attachments[0].name,'说明.txt');assert.equal(result.attachments[0].textContent,'文件内容\n');assert.equal(result.attachments[1].serverRelativePath,'.pi-uploads/report.pdf');
 const append=vm.runInNewContext(extract('  function appendComposerAttachmentsToSubmission','  // Decode the existing submission')+'\nappendComposerAttachmentsToSubmission',{getLanguageForFilename:()=> 'text'});
 assert.equal(append(result.text,result.attachments),payload);
});
test('ordinary code and non-suffix file mentions remain message text',()=>{
 for(const body of ['### `例子.txt`\n```text\n例子\n```\n这是正文','正文\n\n[附件: @a.pdf]\n下一段'])assert.equal(parse(body).text,body);
});
