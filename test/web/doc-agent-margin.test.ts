// E532 (#622): the document's agent margin — which agents are editing, their state, and "what it is doing" in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ago,
  agentsOf,
  applyMarginEvent,
  blocksOfJson,
  changeLabel,
  clearFile,
  doingLines,
  editSentence,
  formOf,
  freezePlace,
  IDLE_MS,
  marginPhase,
  MERGE_MS,
  nextTurnAt,
  placeOf,
  pruneIdle,
  readCollapsed,
  RECENT_MAX,
  stepOf,
  WRITING_MS,
  type BlockInfo,
  type MarginMap,
} from '../../web/src/doc/agentMargin.ts';

const ev = (doc?: unknown, extra = {}) => ({ sid: 's1', name: 'Faye', role: 'impl', color: '#0f766e', file: 'a.dpx.json', ...(doc ? { doc } : {}), ...extra }) as never;
const H = (text: string, level = 2): BlockInfo => ({ type: 'heading', text, level });
const P = (text: string): BlockInfo => ({ type: 'paragraph', text });

test('applyMarginEvent: a doc place adds a change; the same block soon after updates it; gone removes the agent', () => {
  let m: MarginMap = new Map();
  assert.equal(applyMarginEvent(m, ev(), 0, 1), m, 'no place, no agent: nothing');
  assert.equal(applyMarginEvent(m, ev(undefined, { x: 1, y: 2 }), 0, 1), m, 'a canvas-only place opens nothing');
  assert.equal(applyMarginEvent(m, ev({ index: -1, offset: 0 }), 0, 1), m, 'a bad place is ignored');
  assert.equal(applyMarginEvent(m, ev({ index: 0, offset: 0 }, { file: undefined }), 0, 1), m, 'no file: ignored');
  m = applyMarginEvent(m, ev({ index: 2, offset: 4 }), 100, 1);
  const a = m.get('s1')!;
  assert.equal(a.name, 'Faye');
  assert.equal(a.color, '#0f766e');
  assert.equal(a.firstAt, 100);
  assert.deepEqual(a.edits, [{ id: 's1:1', at: 100, spot: { index: 2, offset: 4 } }]);
  // Same block soon after: still one change, moved to the new place and time.
  m = applyMarginEvent(m, ev({ index: 2, offset: 9 }), 600, 2);
  assert.deepEqual(m.get('s1')!.edits, [{ id: 's1:1', at: 600, spot: { index: 2, offset: 9 } }]);
  // Another block: a new change in front.
  m = applyMarginEvent(m, ev({ index: 5, offset: 0 }), 900, 3);
  assert.deepEqual(m.get('s1')!.edits.map((e) => e.id), ['s1:3', 's1:1']);
  // The same block long after: a new change.
  m = applyMarginEvent(m, ev({ index: 5, offset: 3 }), 900 + MERGE_MS, 4);
  assert.deepEqual(m.get('s1')!.edits.map((e) => e.id), ['s1:4', 's1:3', 's1:1']);
  // A canvas edit of the same file keeps it awake without a change.
  m = applyMarginEvent(m, ev(undefined, { x: 3, y: 4 }), 20_000, 5);
  assert.equal(m.get('s1')!.editAt, 20_000);
  assert.equal(m.get('s1')!.edits.length, 3);
  // Only RECENT_MAX changes are kept.
  for (let i = 0; i < 10; i++) m = applyMarginEvent(m, ev({ index: 10 + i, offset: 0 }), 21_000 + i, 10 + i);
  assert.equal(m.get('s1')!.edits.length, RECENT_MAX);
  assert.equal(m.get('s1')!.firstAt, 100, 'the stay goes on');
  m = applyMarginEvent(m, { sid: 's1', gone: true } as never, 30_000, 99);
  assert.equal(m.size, 0);
});

test('applyMarginEvent: another file or a return after idle starts a fresh card', () => {
  let m: MarginMap = applyMarginEvent(new Map(), ev({ index: 1, offset: 0 }), 0, 1);
  m = applyMarginEvent(m, ev({ index: 0, offset: 0 }, { file: 'b.dpx.json' }), 1000, 2);
  assert.equal(m.get('s1')!.file, 'b.dpx.json');
  assert.deepEqual(m.get('s1')!.edits.map((e) => e.id), ['s1:2']);
  assert.equal(m.get('s1')!.firstAt, 1000);
  m = applyMarginEvent(m, ev({ index: 0, offset: 0 }, { file: 'b.dpx.json' }), 1000 + IDLE_MS, 3);
  assert.deepEqual(m.get('s1')!.edits.map((e) => e.id), ['s1:3']);
  // A canvas edit of another file does not keep it.
  const same = applyMarginEvent(m, ev(undefined, { file: 'c.dpx.json', x: 1, y: 1 }), 1000 + IDLE_MS + 1, 4);
  assert.equal(same, m);
});

test('agentsOf / pruneIdle / clearFile / nextTurnAt: the margin shows the file\'s agents until they go idle', () => {
  let m: MarginMap = applyMarginEvent(new Map(), ev({ index: 1, offset: 0 }), 0, 1);
  m = applyMarginEvent(m, ev({ index: 0, offset: 0 }, { sid: 's2', name: 'Cal' }), 500, 2);
  m = applyMarginEvent(m, ev({ index: 0, offset: 0 }, { sid: 's3', name: 'Ann', file: 'b.dpx.json' }), 500, 3);
  assert.deepEqual(agentsOf(m, 'a.dpx.json', 1000).map((a) => a.name), ['Faye', 'Cal'], 'in the order they came');
  assert.deepEqual(agentsOf(m, 'a.dpx.json', IDLE_MS + 100).map((a) => a.name), ['Cal']);
  assert.deepEqual(agentsOf(m, 'a.dpx.json', IDLE_MS + 600), []);
  assert.equal(nextTurnAt(agentsOf(m, 'a.dpx.json', 1000), 1000), WRITING_MS);
  assert.equal(nextTurnAt(agentsOf(m, 'a.dpx.json', 1000), WRITING_MS + 600), IDLE_MS);
  assert.equal(nextTurnAt([], 0), Infinity);
  assert.deepEqual([...pruneIdle(m, IDLE_MS + 100).keys()], ['s2', 's3']);
  assert.equal(pruneIdle(m, 10), m);
  assert.deepEqual([...clearFile(m, 'a.dpx.json').keys()], ['s3']);
  assert.equal(clearFile(m).size, 0);
  assert.equal(clearFile(m, 'zzz'), m);
});

test('freezePlace: words of a change are frozen once', () => {
  const m: MarginMap = applyMarginEvent(new Map(), ev({ index: 1, offset: 0 }), 0, 1);
  const place = { section: '개요', kind: 'text' as const, atEnd: true };
  const m2 = freezePlace(m, 's1', 's1:1', place);
  assert.deepEqual(m2.get('s1')!.edits[0].place, place);
  assert.equal(freezePlace(m2, 's1', 's1:1', { ...place, section: 'x' }), m2);
  assert.equal(freezePlace(m2, 's1', 'nope', place), m2);
  assert.equal(freezePlace(m2, 'nobody', 's1:1', place), m2);
});

test('marginPhase: writing right after an edit, waiting for a person, else thinking', () => {
  assert.equal(marginPhase({ editAt: 0 }, 100), 'writing');
  assert.equal(marginPhase({ editAt: 0 }, 100, { status: 'waiting', state: 'waiting' }), 'writing', 'an edit just now wins');
  assert.equal(marginPhase({ editAt: 0 }, WRITING_MS), 'thinking');
  assert.equal(marginPhase({ editAt: 0 }, WRITING_MS, { status: 'running', state: 'working' }), 'thinking');
  assert.equal(marginPhase({ editAt: 0 }, WRITING_MS, { status: 'running', state: 'waiting' }), 'waiting');
  assert.equal(marginPhase({ editAt: 0 }, WRITING_MS, { status: 'waiting', state: null }), 'waiting');
  assert.equal(marginPhase({ editAt: 0 }, WRITING_MS, { status: 'waiting', state: 'working' }), 'thinking', 'the monitor wins over the hub status');
});

const doc = [H('01. 개요'), P('소개 문단이에요.'), H('02. 화면 지도'), P('화면을 나눠요.'), { type: 'diagram', text: '' }, { type: 'table', text: 'ab' }, H('')];

test('placeOf: the section is the heading at or above the change; the kind and whether it wrote at the end', () => {
  assert.deepEqual(placeOf(doc, { index: 1, offset: 9 }), { section: '01. 개요', kind: 'text', atEnd: true });
  assert.deepEqual(placeOf(doc, { index: 1, offset: 2 }), { section: '01. 개요', kind: 'text', atEnd: false });
  assert.deepEqual(placeOf(doc, { index: 4, offset: 0 }), { section: '02. 화면 지도', kind: 'diagram', atEnd: true });
  assert.deepEqual(placeOf(doc, { index: 5, offset: 1 }), { section: '02. 화면 지도', kind: 'table', atEnd: false });
  assert.deepEqual(placeOf(doc, { index: 2, offset: 3 }), { section: '01. 개요', kind: 'heading', atEnd: false, heading: '02. 화면 지도' });
  assert.deepEqual(placeOf([P('a')], { index: 0, offset: 1 }), { section: null, kind: 'text', atEnd: true });
  // Past the end (the editor has not taken the change in yet): the last block.
  assert.equal(placeOf(doc, { index: 99, offset: 0 })!.kind, 'heading');
  assert.equal(placeOf([], { index: 0, offset: 0 }), null);
  assert.equal(placeOf([{ type: 'weird', text: '' }], { index: 0, offset: 0 })!.kind, 'other');
  // A long heading is clipped.
  assert.equal(placeOf([H('가'.repeat(40)), P('x')], { index: 1, offset: 0 })!.section, `${'가'.repeat(27)}…`);
});

test('editSentence / changeLabel: plain Korean for each kind of change', () => {
  const at = (index: number, offset: number) => editSentence(placeOf(doc, { index, offset })!);
  assert.equal(at(4, 0), '02. 화면 지도 섹션에 다이어그램을 추가하는 중');
  assert.equal(at(1, 9), '01. 개요 섹션에 글을 쓰는 중');
  assert.equal(at(1, 2), '01. 개요 섹션의 글을 고치는 중');
  assert.equal(at(5, 1), '02. 화면 지도 섹션의 표를 고치는 중');
  assert.equal(at(5, 2), '02. 화면 지도 섹션의 표를 채우는 중');
  assert.equal(at(2, 9), '‘02. 화면 지도’ 제목을 쓰는 중');
  assert.equal(at(2, 1), '‘02. 화면 지도’ 제목을 고치는 중');
  assert.equal(at(6, 0), '새 제목을 쓰는 중');
  assert.equal(editSentence({ section: null, kind: 'list', atEnd: true }), '문서 첫머리에 목록을 쓰는 중');
  assert.equal(editSentence({ section: '03 문서', kind: 'code', atEnd: true }), '03 문서 섹션에 코드를 추가하는 중');
  assert.equal(editSentence({ section: '03 문서', kind: 'frame', atEnd: false }), '03 문서 섹션에 프레임을 추가하는 중');
  assert.equal(changeLabel(placeOf(doc, { index: 4, offset: 0 })!), '02. 화면 지도 · 다이어그램');
  assert.equal(changeLabel(placeOf(doc, { index: 2, offset: 0 })!), '제목 · 02. 화면 지도');
  assert.equal(changeLabel({ section: null, kind: 'text', atEnd: true }), '문서 첫머리 · 글');
});

test('doingLines: from the latest change, the tool activity and the step', () => {
  const place = placeOf(doc, { index: 4, offset: 0 })!;
  assert.deepEqual(doingLines({ phase: 'writing', place, step: '화면 지도 그리기', tool: '파일 수정' }), { main: '02. 화면 지도 섹션에 다이어그램을 추가하는 중', sub: '단계: 화면 지도 그리기' });
  assert.deepEqual(doingLines({ phase: 'thinking', place, tool: '코드 읽기' }), { main: '코드 읽기 중', sub: '방금: 02. 화면 지도 · 다이어그램' });
  assert.deepEqual(doingLines({ phase: 'thinking', place, tool: '기다리는 중', step: 'x' }), { main: '기다리는 중', sub: '단계: x' });
  assert.deepEqual(doingLines({ phase: 'thinking', place }), { main: '02. 화면 지도 섹션에 다이어그램을 추가하는 중', sub: null });
  assert.deepEqual(doingLines({ phase: 'thinking' }), { main: '다음 할 일을 생각하는 중', sub: null });
  assert.deepEqual(doingLines({ phase: 'writing' }), { main: '문서를 고치는 중', sub: null });
  assert.deepEqual(doingLines({ phase: 'waiting', place, step: 's' }), { main: '사람의 답을 기다리는 중', sub: '단계: s' });
});

test('ago, stepOf, blocksOfJson, formOf, readCollapsed', () => {
  assert.equal(ago(0), '방금');
  assert.equal(ago(-5), '방금');
  assert.equal(ago(12_400), '12초 전');
  assert.equal(ago(185_000), '3분 전');
  const runs = [[{ title: '설계', view: 'done', agents: [{ name: 'Faye' }] }, { title: '화면 지도 그리기', view: 'active', agents: [{ name: 'Faye' }] }], [{ view: 'active', agents: [{ name: 'Cal' }] }]];
  assert.equal(stepOf('Faye', runs), '화면 지도 그리기');
  assert.equal(stepOf('Cal', runs), null, 'a step without a title says nothing');
  assert.equal(stepOf('', runs), null);
  assert.deepEqual(
    blocksOfJson({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2, id: 'x' }, content: [{ type: 'text', text: '가' }, { type: 'text', text: '나', marks: [{ type: 'bold' }] }] }, { type: 'diagram', attrs: { blockId: 'b' } }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'i' }] }] }] }] }),
    [{ type: 'heading', text: '가나', level: 2 }, { type: 'diagram', text: '' }, { type: 'bulletList', text: 'i' }],
  );
  assert.deepEqual(blocksOfJson(null), []);
  assert.equal(formOf(1200), 'side');
  assert.equal(formOf(800), 'sheet');
  assert.deepEqual(readCollapsed(null), { side: false, sheet: true });
  assert.deepEqual(readCollapsed('{"side":true}'), { side: true, sheet: true });
  assert.deepEqual(readCollapsed('{"side":"x","sheet":false}'), { side: false, sheet: false });
  assert.deepEqual(readCollapsed('not json'), { side: false, sheet: true });
});
