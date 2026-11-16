import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentMeta, agentsIn, fileStem, holdersByFile, parseAgents, safeColor, type AgentPresence } from '../../web/src/home/agents.ts';

const a = (sid: string, x: Partial<AgentPresence> = {}): AgentPresence => ({ sid, name: sid, role: 'impl', model: null, state: 'idle', project: null, file: null, at: 0, ...x });

test('agentsIn keeps the project\'s agents (by folder or held file), busy first, then file holders, then newest', () => {
  const all = [
    a('Idle', { project: 'P', at: 5 }),
    a('Holder', { project: 'P', file: 'P/x.dpx.json', at: 1 }),
    a('Busy', { project: 'P', state: 'running', at: 0 }),
    a('ByFile', { file: 'P/sub/y.dpx.json', state: 'waiting' }),
    a('Other', { project: 'Q', state: 'running', file: 'Q/z.dpx.json' }),
    a('Prefix', { file: 'PX/z.dpx.json' }),
  ];
  assert.deepEqual(agentsIn(all, 'P').map((x) => x.sid), ['Busy', 'ByFile', 'Holder', 'Idle']);
});

test('holdersByFile groups agents by the file they hold', () => {
  const m = holdersByFile([a('A', { file: 'f' }), a('B', { file: 'f' }), a('C')]);
  assert.deepEqual(m.get('f')?.map((x) => x.sid), ['A', 'B']);
  assert.equal(m.size, 1);
});

test('meta, colours and parsing', () => {
  assert.equal(agentMeta(a('A', { roleName: '구현자', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5' })), '구현자 · Opus 5.5');
  assert.equal(agentMeta(a('A', { role: 'impl' })), 'impl');
  assert.equal(agentMeta(a('A', { outside: true })), '외부 API');
  assert.equal(safeColor('#12abEF'), '#12abEF');
  assert.equal(safeColor('red;background:url(x)'), null);
  assert.equal(fileStem('P/02-화면-지도.dpx.json'), '02-화면-지도');
  assert.deepEqual(parseAgents(null), []);
  assert.deepEqual(parseAgents({ agents: [a('A'), { name: 1 }, null] }).map((x) => x.sid), ['A']);
});
