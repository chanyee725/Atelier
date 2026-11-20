import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPipelineView, shownView, switchViews, toCanvas } from '../../web/src/viewMode.ts';

test('shownView: narrow screens show the document instead of both panes', () => {
  assert.equal(shownView('both', true), 'doc');
  assert.equal(shownView('doc', true), 'doc');
  assert.equal(shownView('canvas', true), 'canvas');
  assert.equal(shownView('both', false), 'both');
  assert.equal(shownView('doc', false), 'doc');
});

test('toCanvas: wide screens open the canvas next to the document', () => {
  assert.equal(toCanvas('doc', false), 'both');
  assert.equal(toCanvas('both', false), 'both');
  assert.equal(toCanvas('canvas', false), 'canvas');
});

test('toCanvas: narrow screens switch to the canvas, even from a stored both', () => {
  assert.equal(toCanvas('doc', true), 'canvas');
  assert.equal(toCanvas('both', true), 'canvas');
  assert.equal(shownView(toCanvas('both', true), true), 'canvas');
});

test('toCanvas: from the 실행 view, wide screens open both panes and narrow screens the canvas', () => {
  assert.equal(toCanvas('run', false), 'both');
  assert.equal(toCanvas('run', true), 'canvas');
  assert.equal(shownView('run', true), 'run');
});

test('toCanvas: the 플랜 view (#729) leaves for the canvas like 실행', () => {
  assert.equal(toCanvas('plan', false), 'both');
  assert.equal(toCanvas('plan', true), 'canvas');
  assert.equal(shownView('plan', true), 'plan');
  assert.equal(isPipelineView('plan'), true);
  assert.equal(isPipelineView('run'), true);
  assert.equal(isPipelineView('doc'), false);
});

test('switchViews: the header offers 문서 / 둘 다 / 캔버스, one pane at a time when narrow, 플랜 and 실행 for pipelines', () => {
  const ids = (narrow: boolean, canRun: boolean) => switchViews(narrow, canRun).map((v) => v.id);
  assert.deepEqual(ids(false, false), ['doc', 'both', 'canvas']);
  assert.deepEqual(switchViews(false, false).map((v) => v.label), ['문서', '둘 다', '캔버스']);
  assert.deepEqual(ids(true, false), ['doc', 'canvas']);
  assert.deepEqual(ids(false, true), ['doc', 'both', 'canvas', 'plan', 'run']);
  assert.deepEqual(ids(true, true), ['doc', 'canvas', 'plan', 'run']);
  // Every offered view is shown as picked: the switch never offers a view the screen would replace.
  for (const narrow of [false, true]) for (const v of ids(narrow, true)) assert.equal(shownView(v, narrow), v);
});
