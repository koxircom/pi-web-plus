import test from 'node:test';
import assert from 'node:assert/strict';
import { withProgressCommentary, createProgressCommentaryExtension, PROGRESS_COMMENTARY_GUIDANCE } from './progress-commentary.ts';
test('each coding run preserves current instructions and appends visible progress guidance once',()=>{let handler;createProgressCommentaryExtension().factory({on:(name,h)=>{assert.equal(name,'before_agent_start');handler=h;}});const first=handler({systemPrompt:'最新项目及用户要求'}).systemPrompt;assert(first.startsWith('最新项目及用户要求'));assert(first.includes(PROGRESS_COMMENTARY_GUIDANCE));assert.equal(withProgressCommentary(first),first);const reload=handler({systemPrompt:'重载后的新要求'}).systemPrompt;assert(reload.startsWith('重载后的新要求'));assert(!reload.includes('最新项目及用户要求'));});
