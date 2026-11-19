import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDENT, ROW_HEIGHT, filterDocs, plansByArea, wholeProject, flatFiles, locationOf, pollWhileVisible, relativeTime, runningBelow, runningIn, subCount } from '../../web/src/home/model.ts';
import type { ProjectDoc, ProjectInfo } from '../../web/src/api.ts';

const d = (path: string, title: string, children: ProjectDoc[] = []): ProjectDoc => ({ path, name: path, title, bundle: false, createdAt: 1, modifiedAt: 2, children });
const docs = [d('a', 'Login', [d('a/t', 'Token', [d('a/t/r', 'Refresh')])]), d('b', 'Collect')];

test('subCount counts sub-docs at every level; runningBelow sees a run anywhere under a parent but not the parent itself', () => {
  assert.equal(subCount(docs[0]), 2);
  assert.equal(subCount(docs[1]), 0);
  assert.equal(runningBelow(docs[0], new Set(['a/t/r'])), true);
  assert.equal(runningBelow(docs[0], new Set(['a'])), false);
  assert.equal(runningBelow(docs[1], new Set(['a/t'])), false);
});

function fakePage(state: 'visible' | 'hidden') {
  const listeners = new Set<() => void>();
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    doc: {
      visibilityState: state as string,
      addEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.add(fn),
      removeEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.delete(fn),
    },
    timers: { setInterval: (fn: () => void) => (timers.set(++id, fn), id), clearInterval: (t: unknown) => void timers.delete(t as number) },
    tick: () => [...timers.values()].forEach((fn) => fn()),
    show(next: 'visible' | 'hidden') {
      this.doc.visibilityState = next;
      listeners.forEach((fn) => fn());
    },
    get counts() {
      return { timers: timers.size, listeners: listeners.size };
    },
  };
}

test('pollWhileVisible: polls while visible, stops while hidden, loads at once when shown again', () => {
  const page = fakePage('visible');
  let loads = 0;
  const stop = pollWhileVisible(() => loads++, 10_000, page.doc, page.timers);
  assert.equal(loads, 1, 'loads right away');
  page.tick();
  assert.equal(loads, 2);
  page.show('hidden');
  assert.equal(page.counts.timers, 0, 'no timer while hidden');
  page.tick();
  assert.equal(loads, 2);
  page.show('visible');
  assert.equal(loads, 3, 'catches up as soon as it shows');
  assert.equal(page.counts.timers, 1);
  stop();
  assert.deepEqual(page.counts, { timers: 0, listeners: 0 });
});

test('pollWhileVisible: a page opened hidden waits until it shows', () => {
  const page = fakePage('hidden');
  let loads = 0;
  pollWhileVisible(() => loads++, 10_000, page.doc, page.timers);
  assert.equal(loads, 0);
  assert.equal(page.counts.timers, 0);
  page.show('visible');
  assert.equal(loads, 1);
});

test('filterDocs keeps a matching sub-doc under its parents, and a matching parent with its subtree', () => {
  assert.deepEqual(filterDocs(docs, 'refresh').map((x) => x.title), ['Login']);
  assert.equal(filterDocs(docs, 'refresh')[0].children[0].children[0].title, 'Refresh');
  assert.equal(filterDocs(docs, 'login')[0].children.length, 1);
  assert.equal(filterDocs(docs, 'zzz').length, 0);
});

test('relativeTime in Korean, and row metrics match the spec (41px rows, 24px indent)', () => {
  const now = 1_000_000_000_000;
  assert.equal(relativeTime(now - 5 * 60_000, now), '5분 전');
  assert.equal(relativeTime(now - 3 * 3_600_000, now), '3시간 전');
  assert.equal(relativeTime(0, now), '-');
  assert.equal(ROW_HEIGHT, 41);
  assert.equal(INDENT, 24);
});

test('runningIn counts running files inside the project folder only', () => {
  const running = new Set(['pay/a.dpx.json', 'pay/a/b.dpx.json', 'payroll/c.dpx.json', 'loose.dpx.json']);
  assert.equal(runningIn({ path: 'pay' }, running), 2);
  assert.equal(runningIn({ path: 'other' }, running), 0);
});

test('loose files at the workspace root stay in the flat list with 최상위 as their place (no 미분류, #592)', () => {
  const project = { id: 'p', path: 'p', name: 'P', icon: '', description: '', docCount: 1, modifiedAt: 0, docs: [d('p/x', 'X')] } as unknown as Parameters<typeof flatFiles>[0][number];
  const files = flatFiles([project], [d('loose', 'Loose')]);
  assert.deepEqual(files.map((f) => f.path).sort(), ['loose', 'p/x']);
  assert.equal(locationOf(files.find((f) => f.path === 'loose')!), '최상위');
  assert.equal(locationOf({ project: 'P', parent: 'X' }), 'P / X');
});

test('wholeProject: top folders become groups next to the loose documents, path \'\' (#778)', () => {
  const folder = { id: 'F', path: 'F', name: 'Folder', icon: 'F', description: '', docCount: 3, createdAt: 0, modifiedAt: 7, docs };
  const w = wholeProject({ projects: [folder], unfiled: [d('x', 'Loose')] }, 'Akaka');
  assert.equal(w.path, '');
  assert.equal(w.name, 'Akaka');
  assert.deepEqual(w.docs.map((x) => [x.path, x.bundle]), [['F', true], ['x', false]]);
  assert.equal(w.docs[0].children, docs);
  assert.equal(w.docCount, 5);
  assert.equal(w.modifiedAt, 7);
});

test('plansByArea: every plan grouped by area with its feature folder, newest first; areas without plans dropped (#782)', () => {
  const plan = (path: string, title: string, state: ProjectDoc['plan'], modifiedAt: number): ProjectDoc => ({ ...d(path, title), plan: state, modifiedAt });
  const group = (path: string, children: ProjectDoc[]): ProjectDoc => ({ ...d(path, path.split('/').pop()!, children), bundle: true });
  const area = (path: string, name: string, list: ProjectDoc[]): ProjectInfo => ({ id: path, path, name, icon: '', description: '', docCount: 0, createdAt: 0, modifiedAt: 0, docs: list });
  const projects = [
    area('Server', 'Server', [group('Server/저장', [plan('Server/저장/계획', '저장', 'done', 1), plan('Server/저장/계획-2', '저장 복사', 'plan', 5)]), d('Server/메모', '메모')]),
    area('Web', '웹', [plan('Web/계획', '웹 바로 아래', 'running', 3)]),
    area('Docs', 'Docs', [d('Docs/readme', 'readme')]),
  ];
  const out = plansByArea(projects, [plan('old', '옛 계획', 'paused', 2), d('note', 'note')]);
  assert.deepEqual(out.map((a) => [a.area, a.name, a.plans.map((p) => [p.path, p.feature, p.state])]), [
    ['Server', 'Server', [['Server/저장/계획-2', '저장', 'plan'], ['Server/저장/계획', '저장', 'done']]],
    ['Web', '웹', [['Web/계획', null, 'running']]],
    [null, '최상위', [['old', null, 'paused']]],
  ]);
  assert.deepEqual(plansByArea([], []), []);
});
