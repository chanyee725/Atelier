// 설정 page helpers (#587): team values and patch, and the per-provider usage groups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTeamNumbers, teamPatch, teamValues, usageGroups } from '../../web/src/settings/model.ts';

const roles = [
  { id: 'lead', model: 'claude-sonnet-5-5' },
  { id: 'impl', model: 'claude-opus-5-5' },
];

test('teamValues fills defaults for unset fields and takes each role model', () => {
  const v = teamValues({ rotateLead: 3, shareDeps: false }, roles);
  assert.equal(v.rotateLead, 3);
  assert.equal(v.rotateOthers, 10);
  assert.equal(v.maxChildren, 8);
  assert.equal(v.shareDeps, false);
  assert.equal(v.dropWorktrees, true);
  assert.deepEqual(v.roleModels, { lead: 'claude-sonnet-5-5', impl: 'claude-opus-5-5' });
  assert.equal(teamValues(undefined, []).replyStyle, true);
});

test('teamPatch sends only what changed, role models per role, and null when nothing did', () => {
  const saved = teamValues({}, roles);
  assert.equal(teamPatch(saved, { ...saved, roleModels: { ...saved.roleModels } }), null);
  const next = { ...saved, maxChildren: 4, replyStyle: false, roleModels: { ...saved.roleModels, impl: 'gpt-5-codex' } };
  assert.deepEqual(teamPatch(saved, next), { maxChildren: 4, replyStyle: false, roleModels: { impl: 'gpt-5-codex' } });
  // An empty model choice is never sent (the server would read it as "back to the preset").
  assert.equal(teamPatch(saved, { ...saved, roleModels: { ...saved.roleModels, lead: '' } }), null);
});

test('readTeamNumbers rejects an out-of-range or non-whole value with its label', () => {
  assert.deepEqual(readTeamNumbers({ rotateLead: '0', rotateOthers: '12', maxChildren: '16' }), { rotateLead: 0, rotateOthers: 12, maxChildren: 16 });
  const bad = readTeamNumbers({ rotateLead: '5', rotateOthers: '1.5', maxChildren: '8' });
  assert.ok('error' in bad && bad.error.startsWith('다른 역할 대화 새로 시작'));
  const zero = readTeamNumbers({ rotateLead: '5', rotateOthers: '5', maxChildren: '0' });
  assert.ok('error' in zero && zero.error.includes('1~16'));
});

test('usageGroups reads each connected provider by its own id, with sub-buckets in their own group', () => {
  const limits = {
    claude: { windows: [{ label: '5시간', used: 0.4, reset: 1000 }] },
    fable: { windows: [{ label: 'Fable 주간', used: 0.2 }] },
    alpha: { windows: [{ label: '주간', used: 0.7 }], plan: 'pro' },
    beta: { reached: true, reset: 5000 },
    gamma: { windows: [{ label: '주간', used: 0.9 }] },
  };
  const providers = {
    alpha: { name: 'Alpha', connected: true },
    beta: { name: 'Beta', connected: true },
    gamma: { name: 'Gamma', connected: false },
  };
  const g = usageGroups(limits, providers);
  assert.deepEqual(g.map((x) => x.id), ['alpha', 'beta'], 'only connected providers, in their order');
  assert.deepEqual(g[0], { id: 'alpha', name: 'Alpha', windows: [{ label: '주간', used: 0.7 }], plan: 'pro', reached: null, reset: null });
  assert.deepEqual(g[1], { id: 'beta', name: 'Beta', windows: [], plan: null, reached: true, reset: 5000 });
  // Claude's windows never leak into another provider; Fable joins Claude's own group.
  const withClaude = usageGroups(limits, { claude: { name: 'Claude', connected: true }, alpha: { connected: true } });
  assert.deepEqual(withClaude[0].windows.map((w) => w.label), ['5시간', 'Fable 주간']);
  assert.equal(withClaude[1].name, 'alpha', 'falls back to the id');
  assert.deepEqual(usageGroups({}, { alpha: { name: 'Alpha', connected: true } })[0].windows, []);
});
