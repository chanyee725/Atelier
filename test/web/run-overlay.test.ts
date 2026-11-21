import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../shared/dsl/index.ts';
import { edgeKey, layoutDiagram, nodeRects } from '../../shared/render/index.ts';
import type { Scene } from '../../shared/render/index.ts';
import { agentColors, boardShown, legendOf, legendSpot, liveTargets, nodeBadges, pressAction, overlayModel, pathData, roleColor, roleLabel, runProgress, stepMarks } from '../../web/src/run/overlayModel.ts';
import { FIXTURE_BLOCKED, FIXTURE_CODE, FIXTURE_STEPS } from '../../web/src/run/fixture.ts';
import { RUN_BAND } from '../../shared/render/badge.ts';

async function scene(code: string): Promise<Scene> {
  const { ast } = parse(code, 'flowchart');
  return layoutDiagram(ast);
}

test('one ring per linked step, on its node box, glyph and text with every state', async () => {
  const s = await scene(FIXTURE_CODE);
  const m = overlayModel(s, FIXTURE_STEPS);
  const rects = nodeRects(s);
  assert.deepEqual(m.nodes.map((n) => [n.node, n.view, n.glyph]), [
    ['plan', 'done', '✓'],
    ['impl', 'done', '✓'],
    ['review', 'review', '?'],
    ['test', 'active', '●'],
    ['merge', 'pending', '◌'],
  ]);
  for (const n of m.nodes) {
    assert.deepEqual(n.rect, rects.get(n.node));
    // Never colour alone: the visible text starts with the state label.
    assert.match(n.text, /^(대기|진행|리뷰|완료|막힘|실패|결정 필요)/);
  }
  assert.deepEqual(m.missing, []);
});

test('colours: the step state paints the node (#687), not the agent role', async () => {
  const m = overlayModel(await scene(FIXTURE_CODE), FIXTURE_STEPS);
  const by = new Map(m.nodes.map((n) => [n.node, n]));
  assert.equal(by.get('review')!.color, 'var(--step-blocked)');
  assert.equal(by.get('review')!.tone, 'blocked');
  assert.equal(by.get('test')!.color, 'var(--step-active)');
  assert.equal(by.get('plan')!.color, 'var(--step-done)');
  assert.equal(by.get('merge')!.color, 'var(--step-pending)');
  assert.equal(by.get('review')!.live, true);
  assert.equal(by.get('plan')!.live, false);
  const b = overlayModel(await scene(FIXTURE_CODE), FIXTURE_BLOCKED).nodes.find((n) => n.node === 'test')!;
  assert.equal(b.color, 'var(--step-blocked)');
  assert.equal(b.live, false);
  assert.equal(b.glyph, '⚠');
  const f = overlayModel(await scene(FIXTURE_CODE), FIXTURE_BLOCKED.map((s) => (s.id === 'test' ? { ...s, failed: true } : s))).nodes.find((n) => n.node === 'test')!;
  assert.deepEqual([f.tone, f.color, f.glyph, f.text], ['failed', 'var(--step-failed)', '✕', '실패 · Pell']);
});

test('active step with no session yet is blue', async () => {
  const m = overlayModel(await scene('a\nb\na > b'), [{ id: 'a', view: 'active' }]);
  assert.equal(m.nodes[0]!.color, 'var(--step-active)');
});

test('labels: name, state, agents with role, waiting tag only when live', async () => {
  const m = overlayModel(await scene(FIXTURE_CODE), FIXTURE_STEPS);
  const by = new Map(m.nodes.map((n) => [n.node, n]));
  assert.equal(by.get('review')!.label, 'Review · 결정 필요 · Oren(리뷰어) · 사람 기다림');
  assert.equal(by.get('impl')!.label, 'Implement · 완료 · Juno(구현자) · Tali(구현자)');
  assert.equal(by.get('impl')!.text, '완료 · Juno · Tali');
  assert.equal(by.get('merge')!.text, '대기');
  const done = overlayModel(await scene('a'), [{ id: 'a', view: 'done', waiting: true }]).nodes[0]!;
  assert.equal(done.waiting, false);
  const many = overlayModel(await scene('a'), [{ id: 'a', view: 'active', agents: ['A', 'B', 'C'].map((name) => ({ name, role: 'impl' })) }]).nodes[0]!;
  assert.equal(many.text, '진행 · A 외 2');
});

test('same role: same hue, a lightness step per agent, kept across steps', () => {
  const c = agentColors([
    { id: 'x', view: 'active', agents: [{ name: 'Juno', role: 'impl' }, { name: 'Tali', role: 'impl' }] },
    { id: 'y', view: 'active', agents: [{ name: 'Tali', role: 'impl' }, { name: 'Oren', role: 'review' }, { name: 'Ash', role: 'impl' }, { name: 'Bo', role: 'impl' }] },
  ]);
  assert.equal(c.get('Juno'), 'var(--role-impl)');
  assert.equal(c.get('Tali'), roleColor('impl', 1));
  assert.match(c.get('Tali')!, /^color-mix\(in oklch, var\(--role-impl\)/);
  assert.equal(c.get('Ash'), roleColor('impl', 2));
  assert.equal(c.get('Bo'), roleColor('impl', 2));
  assert.equal(c.get('Oren'), 'var(--role-review)');
  assert.equal(roleColor('someone'), 'var(--idle)');
});

test('edges: flow from done into active/review in the target colour, solid green between done steps', async () => {
  const m = overlayModel(await scene(FIXTURE_CODE), FIXTURE_STEPS);
  const by = new Map(m.edges.map((e) => [e.key, e]));
  assert.deepEqual([...by.keys()].sort(), [edgeKey('impl', 'review'), edgeKey('impl', 'test'), edgeKey('plan', 'impl')].sort());
  assert.equal(by.get(edgeKey('plan', 'impl'))!.kind, 'done');
  assert.equal(by.get(edgeKey('plan', 'impl'))!.color, 'var(--step-done)');
  assert.equal(by.get(edgeKey('impl', 'review'))!.kind, 'flow');
  assert.equal(by.get(edgeKey('impl', 'review'))!.color, 'var(--step-blocked)');
  // Into a blocked step: drawn as is.
  const b = overlayModel(await scene(FIXTURE_CODE), FIXTURE_BLOCKED);
  assert.equal(b.edges.some((e) => e.key === edgeKey('impl', 'test')), false);
});

test('missing nodes are listed, not drawn; edges to non-step nodes ignored', async () => {
  const m = overlayModel(await scene('a\nb\nc\na > b\nb > c'), [
    { id: 'a', view: 'done' },
    { id: 'b', view: 'active' },
    { id: 'gone', view: 'active' },
  ]);
  assert.deepEqual(m.nodes.map((n) => n.node), ['a', 'b']);
  assert.deepEqual(m.missing, ['gone']);
  assert.deepEqual(m.edges.map((e) => e.key), [edgeKey('a', 'b')]);
});

test('step.node links to a differently named node', async () => {
  const m = overlayModel(await scene('x\ny\nx > y'), [{ id: 's1', node: 'x', view: 'done' }, { id: 's2', node: 'y', view: 'review' }]);
  assert.deepEqual(m.nodes.map((n) => [n.step, n.node]), [['s1', 'x'], ['s2', 'y']]);
  assert.equal(m.edges[0]!.kind, 'flow');
});

test('pathData', () => {
  assert.equal(pathData([{ x: 0, y: 0 }, { x: 10.04, y: 5 }, { x: 10, y: 20.55 }]), 'M0 0L10 5L10 20.6');
});

test('progress and legend: weighted progress, only the agents and states present', async () => {
  const m = overlayModel(await scene(FIXTURE_CODE), FIXTURE_STEPS);
  // plan 1 + impl 1 + review 0.8 + test 0.5 + merge 0 = 3.3 of 5 → 66%.
  assert.deepEqual(m.progress, { total: 5, done: 2, blocked: 0, remaining: 3, percent: 66 });
  assert.deepEqual(m.legend.agents.map((a) => [a.name, a.roleName]), [
    ['Mira', '관리자'],
    ['Juno', '구현자'],
    ['Tali', '구현자'],
    ['Oren', '리뷰어'],
    ['Pell', '테스터'],
  ]);
  assert.equal(m.legend.agents[2]!.color, roleColor('impl', 1));
  assert.deepEqual(m.legend.states.map((s) => `${s.glyph} ${s.label}`), ['◌ 대기', '● 진행', '✓ 완료', '? 결정 필요']);
  const b = legendOf(FIXTURE_BLOCKED);
  assert.deepEqual(b.states.map((s) => s.tone), ['pending', 'done', 'blocked', 'blocked']);
  assert.deepEqual(b.states.map((s) => s.label), ['대기', '완료', '결정 필요', '막힘']);
  assert.equal(b.states.at(-1)!.color, 'var(--step-blocked)');
});

test('progress: a blocked step keeps its weight, a skipped step leaves the count', () => {
  const blocked = FIXTURE_STEPS.map((s) => (s.id === 'test' ? { ...s, view: 'blocked' as const, before: 'active' as const } : s));
  assert.equal(runProgress(blocked).percent, runProgress(FIXTURE_STEPS).percent);
  assert.equal(runProgress(blocked).blocked, 1);
  const skipped = FIXTURE_STEPS.map((s) => (s.id === 'merge' ? { ...s, skipped: true } : s));
  assert.deepEqual(runProgress(skipped), { total: 4, done: 2, blocked: 0, remaining: 2, percent: 82 });
  assert.equal(legendOf(skipped).states.some((s) => s.view === 'pending'), false);
});

test('boardShown: the legend shows only when a step links to a node', async () => {
  const s = await scene(FIXTURE_CODE);
  assert.equal(boardShown(s, FIXTURE_STEPS), true);
  assert.equal(boardShown(s, [{ id: 'nowhere', view: 'active' }]), false);
  assert.equal(boardShown(s, []), false);
});

test('legendSpot: under the picture, else left, right, above; always inside the overlay', () => {
  const size = { width: 200, height: 120 };
  const area = { width: 1000, height: 700 };
  // Room under the picture (the label reach is left free).
  assert.deepEqual(legendSpot({ left: 100, top: 100, width: 300, height: 200 }, size, area, 12, 20), { left: 100, top: 332 });
  // Picture at the bottom: left of it.
  assert.deepEqual(legendSpot({ left: 400, top: 500, width: 300, height: 190 }, size, area), { left: 188, top: 500 });
  // Bottom-left corner: right of it.
  assert.deepEqual(legendSpot({ left: 10, top: 500, width: 300, height: 190 }, size, area), { left: 322, top: 500 });
  // Bottom, spanning the width: above it.
  assert.deepEqual(legendSpot({ left: 10, top: 300, width: 980, height: 390 }, size, area), { left: 10, top: 168 });
  // Picture fills the pane: under it, clamped inside the overlay.
  const p = legendSpot({ left: -50, top: -50, width: 1200, height: 900 }, size, area);
  assert.deepEqual(p, { left: 8, top: area.height - size.height - 8 });
});

test('eta panel (#735): working agents only, goal step left out, extra rows fold into +N', async () => {
  const { etaPanel } = await import('../../web/src/run/overlayModel.ts');
  const eta = { kind: 'unknown' as const };
  const mk = (id: string, view: 'active' | 'done' | 'pending', names: string[], title = id) => ({ id, view, title, agents: names.map((name) => ({ name, role: 'impl', eta })) });
  const steps = [mk('목표', 'active', ['Goal']), mk('a', 'done', ['Old']), mk('b', 'active', ['Ann', 'Bo', 'Cy']), mk('c', 'active', ['Di', 'Ed', 'Flo'])];
  const p = etaPanel(steps as never, undefined, 4);
  assert.deepEqual(p.rows.map((r) => r.name), ['Ann', 'Bo', 'Cy', 'Di']);
  assert.equal(p.more, 2);
  assert.equal(p.rows[0]!.initial, 'A');
  assert.deepEqual(etaPanel([mk('x', 'pending', ['Z'])] as never).rows, []);
});

test('badges (#687): initial in role colour per agent, hover title with role, model and state, "+N" past the limit', async () => {
  const agents = [
    { name: 'juno', role: 'impl', model: 'Opus 5.5', state: 'working' as const },
    { name: 'Tali', role: 'impl' },
    { name: 'Oren', role: 'review', state: 'waiting' as const },
  ];
  const n = overlayModel(await scene('a'), [{ id: 'a', view: 'active', agents }]).nodes[0]!;
  assert.deepEqual(n.badges.shown.map((b) => [b.initial, b.color]), [
    ['J', 'var(--role-impl)'],
    ['T', roleColor('impl', 1)],
    ['O', 'var(--role-review)'],
  ]);
  assert.equal(n.badges.shown[0]!.title, 'juno · 구현자 · Opus 5.5 · 일하는 중');
  assert.equal(n.badges.shown[2]!.title, 'Oren · 리뷰어 · 답 기다림');
  assert.equal(n.badges.more, 0);
  const five = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, role: 'test' }));
  const b = nodeBadges(five, new Map());
  assert.deepEqual([b.shown.length, b.more], [3, 2]);
  // Past three the rest fold into "+N" (#987): four agents draw three badges and "+1".
  assert.deepEqual([nodeBadges(five.slice(0, 4), new Map()).shown.length, nodeBadges(five.slice(0, 4), new Map()).more], [3, 1]);
  assert.deepEqual(nodeBadges(five.slice(0, 3), new Map()).more, 0);
  assert.deepEqual(overlayModel(await scene('a'), [{ id: 'a', view: 'pending' }]).nodes[0]!.badges, { shown: [], more: 0 });
});

test('live targets (#736): only an in-progress node opens live views, one per agent with a session id', async () => {
  const agents = [
    { sid: 's1', name: 'Juno', role: 'impl' },
    { name: 'Tali', role: 'impl' },
    { sid: 's3', name: 'Oren', role: 'review' },
  ];
  assert.deepEqual(liveTargets({ view: 'active', agents }), [
    { sid: 's1', name: 'Juno' },
    { sid: 's3', name: 'Oren' },
  ]);
  assert.deepEqual(liveTargets({ view: 'review', agents: agents.slice(0, 1) }), [{ sid: 's1', name: 'Juno' }]);
  for (const view of ['pending', 'done', 'blocked'] as const) assert.deepEqual(liveTargets({ view, agents }), []);
  const m = overlayModel(await scene('a\nb'), [
    { id: 'a', view: 'active', time: '8분째', agents },
    { id: 'b', view: 'done', agents },
  ]);
  assert.deepEqual(m.nodes.map((n) => [n.node, n.open.length, n.time]), [
    ['a', 2, '8분째'],
    ['b', 0, undefined],
  ]);
});

test('press (#736): one agent opens its live view at once, several show the list to pick from', () => {
  assert.equal(pressAction([]), null);
  assert.deepEqual(pressAction([{ sid: 's1', name: 'Juno' }]), { kind: 'open', sid: 's1' });
  assert.deepEqual(pressAction([{ sid: 's1', name: 'Juno' }, { sid: 's3', name: 'Oren' }]), { kind: 'pick' });
});

test('step marks (#935): chips and a progress line only, never a fill or ring over the node', () => {
  const rect = { x: 100, y: 50, w: 160, h: 52 };
  const idle = stepMarks({ rect, glyph: '○', text: '대기', live: false }, true);
  assert.deepEqual(Object.keys(idle).sort(), ['chip', 'label']);
  assert.equal(idle.label!.text, '○ 대기');
  // #971: inside the node's width; #987: in the band above the top edge, so no mark covers the node's text.
  for (const r of [idle.chip, idle.label!]) {
    assert.ok(r.x >= rect.x && r.x + r.w <= rect.x + rect.w, 'inside the node horizontally');
    assert.ok(r.y + r.h <= rect.y, 'above the top edge, never over the text');
    assert.ok(r.y >= rect.y - RUN_BAND, 'inside the band the layout keeps free');
  }
  // Beside two agent badges the long label falls back to the state word, then to the glyph chip alone.
  const busy = { rect, glyph: '✓', text: '완료 · Juno · Tali · Oren · Pell', live: false };
  assert.equal(stepMarks(busy, true, 31).label!.text, '✓ 완료');
  assert.ok(stepMarks(busy, true, 31).label!.x >= rect.x + 10 + 31, 'clear of the badges');
  assert.equal(stepMarks({ ...busy, rect: { ...rect, w: 60 } }, true, 31).label, undefined);
  const live = stepMarks({ rect, glyph: '▶', text: '진행 · Juno', live: true }, false);
  assert.equal(live.label, undefined, 'labels hidden when too small');
  const p = live.progress!;
  assert.equal(p.y, rect.y + rect.h - 2, 'progress line inside the bottom edge');
  assert.ok(p.x1 > rect.x && p.x2 < rect.x + rect.w);
});

test('run layer CSS (#935): no node fill, no dashed ring', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../web/src/index.css', import.meta.url), 'utf8');
  const tsx = await readFile(new URL('../../web/src/run/RunLayer.tsx', import.meta.url), 'utf8');
  for (const src of [css, tsx]) assert.doesNotMatch(src, /run-fill|run-ring/);
});

test('role names that are Object.prototype keys are not roles (#948)', () => {
  assert.equal(roleLabel('constructor'), 'constructor');
  assert.equal(roleColor('toString'), 'var(--idle)');
  assert.notEqual(roleLabel('impl'), 'impl');
});

test('run-mark band (#987): `runMarks on` keeps a free band above every node and widens the gaps by it', async () => {
  for (const dir of ['down', 'right'] as const) {
    const code = `direction ${dir}\na\nb\nc\na > b\na > c`;
    const plain = nodeRects(await scene(code));
    const marked = await scene(`${code}\nrunMarks on`);
    const rects = nodeRects(marked);
    // The top row has the band inside the picture.
    const top = Math.min(...[...rects.values()].map((r) => r.y));
    assert.ok(top >= RUN_BAND, `${dir}: band above the top row`);
    // Every band is free: no other node reaches into the RUN_BAND above a node.
    for (const [id, r] of rects)
      for (const [other, o] of rects) {
        if (id === other) continue;
        const overlapX = o.x < r.x + r.w && o.x + o.w > r.x;
        const overlapY = o.y < r.y && o.y + o.h > r.y - RUN_BAND;
        assert.ok(!(overlapX && overlapY), `${dir}: ${other} is clear of ${id}'s band`);
      }
    // The gap that runs vertically grew by the band.
    const gap = (m: Map<string, { y: number; h: number }>) => {
      const ys = [...m.values()].sort((p, q) => p.y - q.y);
      return ys.at(-1)!.y - (ys[0]!.y + ys[0]!.h);
    };
    assert.equal(gap(rects as never) - gap(plain as never), RUN_BAND);
  }
});
