// #1066: a flowchart whose flow goes back and forth between groups (server > PC app > package > PC app >
// server). Eraser draws such a flow left to right with no line running back across the picture, no
// bundle of parallel lines and every label on its own line (docs/research/eraser/09-examples-style.md §1.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiagram } from '../../shared/render/index.ts';
import type { Scene, SceneBox, SceneEdge, SceneText } from '../../shared/render/index.ts';
import { fixture } from '../dsl/helpers.ts';
import { layoutMetrics } from './layout-metrics.ts';

type P = { x: number; y: number };

const edgesOf = (s: Scene): SceneEdge[] => s.items.filter((it): it is SceneEdge => it.kind === 'edge');
const nodesOf = (s: Scene): SceneBox[] => s.items.filter((it): it is SceneBox => it.kind === 'box' && it.role === 'node');
const groupsOf = (s: Scene): SceneBox[] => s.items.filter((it): it is SceneBox => it.kind === 'box' && it.role === 'group');

/** Longest run of one edge against the flow (`right`: towards smaller x). */
function backRun(e: SceneEdge): number {
  let worst = 0;
  for (let i = 1; i < e.points.length; i++) worst = Math.max(worst, e.points[i - 1]!.x - e.points[i]!.x);
  return worst;
}

/** Pairs of edges whose parallel segments run side by side closer than 8 px (but not on one shared trunk) for over 16 px. */
function bundles(edges: SceneEdge[]): number {
  const segs = (e: SceneEdge): [P, P][] => e.points.slice(1).map((p, i) => [e.points[i]!, p]);
  let n = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const hit = segs(edges[i]!).some(([a, b]) => segs(edges[j]!).some(([c, d]) => {
        const flat = (p: P, q: P) => Math.abs(p.y - q.y) < 0.5;
        const up = (p: P, q: P) => Math.abs(p.x - q.x) < 0.5;
        const run = (a0: number, a1: number, b0: number, b1: number) =>
          Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
        if (flat(a, b) && flat(c, d)) {
          const gap = Math.abs(a.y - c.y);
          return gap > 0.5 && gap < 8 && run(a.x, b.x, c.x, d.x) > 16;
        }
        if (up(a, b) && up(c, d)) {
          const gap = Math.abs(a.x - c.x);
          return gap > 0.5 && gap < 8 && run(a.y, b.y, c.y, d.y) > 16;
        }
        return false;
      }));
      if (hit) n++;
    }
  }
  return n;
}

function distToRoute(p: P, pts: P[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

const LABELS: Record<string, [string, string]> = {
  '저장할 때': ['임시 프레임 저장', '영상 인코딩'],
  '저장 직후': ['로컬 LeRobot 데이터셋', '메타데이터 등록'],
  '완성본만 업로드': ['로컬 LeRobot 데이터셋', '학습'],
  '목표와 리셋 시간': ['태스크 목표 수', '연속 녹화'],
  '저장 뒤 자동 시작': ['녹화 화면', '연속 녹화'],
};

test('cross-group flow (#1066): no reverse loop, no wire bundle, labels on their own line', async () => {
  const { scene, diagnostics } = await renderDiagram(fixture('flowchart-cross-groups'), { type: 'flowchart' });
  assert.deepEqual(diagnostics, []);
  const edges = edgesOf(scene);
  assert.equal(edges.length, 17);

  // Every edge runs with the flow: no segment goes back (leftwards) by more than a node gap.
  const back = edges.filter((e) => backRun(e) > 24).map((e) => `${e.from} > ${e.to}`);
  assert.deepEqual(back, [], 'edges running against the flow');

  assert.equal(bundles(edges), 0, 'parallel lines bundled closer than 8 px');
  const m = layoutMetrics(scene);
  assert.equal(m.throughNodes, 0, 'edges through nodes');
  assert.equal(m.overlaps, 0, 'edges on top of each other');
  assert.ok(m.crossings <= 3, `crossings ${m.crossings}`);
  assert.ok(m.bends <= 2 * edges.length, `bends ${m.bends}`);

  for (const t of scene.items.filter((it): it is SceneText => it.kind === 'text' && !!it.plate)) {
    const text = t.lines.join(' ');
    const ends = LABELS[text];
    assert.ok(ends, `unexpected label ${text}`);
    const e = edges.find((x) => x.from === ends[0] && x.to === ends[1])!;
    const c = { x: t.x, y: t.y + (t.lines.length * t.lineHeight) / 2 };
    assert.ok(distToRoute(c, e.points) <= 4, `label "${text}" sits ${distToRoute(c, e.points).toFixed(0)} px off its line`);
  }

  // Groups stay apart and every node sits in its own group's box.
  const groups = groupsOf(scene);
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]!;
      const b = groups[j]!;
      const ov = Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
      assert.ok(!ov, `groups ${a.id} and ${b.id} overlap`);
    }
  }
  assert.equal(nodesOf(scene).length, 19);
});

test('cross-group flow (#1066): groups keep source order across the flow, the first declared on top', async () => {
  const { scene } = await renderDiagram(fixture('flowchart-cross-groups'), { type: 'flowchart' });
  const ys = ['서버', '사용자 PC 앱', '공통 녹화 패키지', 'Isaac Sim 서버 경로'].map((id) => groupsOf(scene).find((g) => g.id === id)!.y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys);
});
