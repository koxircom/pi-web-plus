import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const { getToolPublicStatus, getToolPublicCategoryKey } = await createJiti(import.meta.url).import('./tool-public-status.ts');
test('tool success requires a final result; partial output never counts as success',()=>{const b={toolName:'bash'};assert.equal(getToolPublicStatus(b),'running');assert.equal(getToolPublicStatus(b,{content:[],inProgress:true}),'running');assert.equal(getToolPublicStatus(b,{content:[],isError:true}),'failure');assert.equal(getToolPublicStatus(b,{content:[],isError:false}),'success');assert.equal(getToolPublicStatus({toolName:'apply_patch'},{content:[],details:{result:{failures:[{filePath:'a',message:'fail'}]}}}),'failure');});
test('unknown tools use a neutral category rather than expose their raw name',()=>{assert.equal(getToolPublicCategoryKey('unknown_sensitive_name'),'chat.toolCategory.generic');assert.equal(getToolPublicCategoryKey('bash'),'chat.toolCategory.command');assert.equal(getToolPublicCategoryKey('read'),'chat.toolCategory.read');});
