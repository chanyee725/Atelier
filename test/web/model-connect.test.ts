// #570 (E525): model connection state for the sidebar row and the 모델 연결 dialog (ported from Dispatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, actionFor, cliLogoutShown, keyLoginShown, connectKey, doneText, limitRows, loginUrl, metaLine, objParticle, providerMeta, rowStatus, type ProviderMeta } from '../../web/src/modelConnect.ts';
import type { ProviderState } from '../../web/src/api.ts';

const C = providerMeta('claude')!;
const P = (o: Partial<ProviderState> = {}): ProviderState => ({ installed: true, connected: false, busy: false, url: null, error: null, ...o });

test('connectKey follows the contract table: off, missing, busy, connected, idle', () => {
  assert.equal(connectKey(P({ connected: true }), false), 'off');
  assert.equal(connectKey(undefined, true), 'idle');
  assert.equal(connectKey(P({ installed: null }), true), 'idle', 'not checked yet shows 연결');
  assert.equal(connectKey(P({ installed: false, busy: true }), true), 'missing');
  assert.equal(connectKey(P({ busy: true, connected: true }), true), 'busy');
  assert.equal(connectKey(P({ connected: true }), true), 'connected');
  assert.equal(connectKey(P({ error: 'x' }), true), 'idle');
});

test('actionFor: one button per state; nothing when pipelines are off', () => {
  assert.equal(actionFor('off'), null);
  assert.equal(actionFor('missing'), 'recheck');
  assert.equal(actionFor('busy'), 'cancel');
  assert.equal(actionFor('connected'), 'disconnect');
  assert.equal(actionFor('idle'), 'connect');
});

test('rowStatus: text and tone; connected shows 5-hour usage or 한도 도달', () => {
  assert.deepEqual(rowStatus(C, P({ installed: false }), true, {}), { key: 'missing', text: '설치 안 됨', tone: 'bad' });
  assert.deepEqual(rowStatus(C, P({ busy: true }), true, {}), { key: 'busy', text: '로그인 중', tone: 'warn' });
  assert.deepEqual(rowStatus(C, P(), true, {}), { key: 'idle', text: '연결 안 됨', tone: 'off' });
  assert.deepEqual(rowStatus(C, P({ connected: true }), true, {}), { key: 'connected', text: '연결됨', tone: 'ok' });
  const lim = { claude: { windows: [{ label: '5시간', used: 0.42 }, { label: '주간', used: 0.1 }] } };
  assert.equal(rowStatus(C, P({ connected: true }), true, lim).text, '42%');
  const full = { claude: { windows: [{ label: '5시간', used: 0.2 }] }, fable: { windows: [{ label: '주간', used: 1 }] } };
  assert.deepEqual(rowStatus(C, P({ connected: true }), true, full), { key: 'connected', text: '한도 도달', tone: 'warn' });
  assert.equal(rowStatus(C, P({ connected: true }), false, lim).text, '연결 안 됨');
});

test('metaLine never shows more than CLI version and login method', () => {
  assert.equal(metaLine(C, undefined), 'Claude Code CLI로 로그인해요');
  assert.equal(metaLine(C, P({ installed: false })), 'Claude Code 필요');
  assert.equal(metaLine(C, P({ cli: '2.1.0 (Claude Code)', cliLoggedIn: true, method: '구독 계정 (claude.ai)' })), '2.1.0 (Claude Code) · 구독 계정 (claude.ai)');
  assert.equal(metaLine(C, P({ cli: '2.1.0', cliLoggedIn: false })), '2.1.0 · CLI 로그인 안 됨');
});

test('loginUrl: only an https link, only while busy', () => {
  assert.equal(loginUrl(P({ busy: true, url: 'https://example.test/x' })), 'https://example.test/x');
  assert.equal(loginUrl(P({ busy: true, url: 'javascript:alert(1)' })), null);
  assert.equal(loginUrl(P({ busy: false, url: 'https://example.test/x' })), null);
});

test('doneText: connect says so only when connected at once; cancel is not an error', () => {
  assert.equal(doneText(C, 'connect', { connected: true }), 'Claude를 연결했어요.');
  assert.equal(doneText(C, 'connect', { connected: false }), null);
  assert.equal(doneText(C, 'cancel', null), '로그인을 취소했어요.');
  assert.match(doneText(C, 'disconnect', null) ?? '', /CLI 로그인은 남아요/);
  assert.equal(doneText(C, 'recheck', null), null);
});

test('limitRows: account windows, then Fable weekly; null Fable until reported', () => {
  const r = limitRows(C, { claude: { windows: [{ label: '5시간', used: 0.5, reset: 123 }, { label: '주간', used: null }] }, fable: null })!;
  assert.deepEqual(r.main, [{ label: '5시간', pct: 50, reset: 123 }, { label: '주간', pct: null, reset: null }]);
  assert.equal(r.fable, null);
  assert.deepEqual(limitRows(C, { fable: { windows: [{ label: '주간', used: 0.3 }] } })!.fable, [{ label: 'Fable 주간', pct: 30, reset: null }]);
});

test('providers are keyed by id; rows for Claude, Codex, Gemini; copy comes from the provider', () => {
  assert.deepEqual(PROVIDERS.map((m) => m.id), ['claude', 'openai', 'gemini']);
  assert.equal(providerMeta('nope'), undefined);
  const X: ProviderMeta = { id: 'x', name: 'X 모델', short: '엑스', cliName: 'X CLI', mark: 'X', usage: false };
  assert.equal(doneText(X, 'connect', { connected: true }), '엑스를 연결했어요.');
  assert.equal(metaLine(X, P({ installed: false })), 'X CLI 필요');
  assert.equal(limitRows(X, { claude: { windows: [{ label: '5시간', used: 0.5 }] } }), null, 'no usage rows for a provider that reports none');
  assert.equal(rowStatus(X, P({ connected: true }), true, { claude: { windows: [{ label: '5시간', used: 0.5 }] } }).text, '연결됨', "Claude's usage is not shown on another row");
  assert.equal(objParticle('로그인'), '을');
  assert.equal(objParticle('Claude'), '를');
});

test('usage is read under each provider id, never Claude numbers on another row (PR #598 review)', () => {
  const O = providerMeta('openai')!;
  const G = providerMeta('gemini')!;
  const lim = { claude: { windows: [{ label: '5시간', used: 0.9 }] }, openai: { windows: [{ label: '5시간', used: 0.2 }, { label: '주간', used: 0.4 }] }, gemini: { reached: false, reset: null } };
  assert.equal(rowStatus(C, P({ connected: true }), true, lim).text, '90%');
  assert.equal(rowStatus(O, P({ connected: true }), true, lim).text, '20%');
  assert.equal(rowStatus(G, P({ connected: true }), true, lim).text, '연결됨');
  assert.equal(rowStatus(G, P({ connected: true }), true, { ...lim, gemini: { reached: true, reset: 5 } }).text, '한도 도달');
  assert.deepEqual(limitRows(O, lim)!.main.map((r) => r.pct), [20, 40]);
  assert.equal(limitRows(O, { ...lim, fable: { windows: [{ label: '주간', used: 1 }] } })!.fable, null, 'Fable only under Claude');
  assert.equal(rowStatus(O, P({ connected: true }), true, { claude: { windows: [{ label: '5시간', used: 1 }] } }).text, '연결됨');
});

test('API-key field only for Codex, installed, not connected, CLI not logged in; CLI logout only when CLI logged in', () => {
  const O = providerMeta('openai')!;
  assert.equal(keyLoginShown(O, P(), true), true);
  assert.equal(keyLoginShown(C, P(), true), false);
  assert.equal(keyLoginShown(O, P({ cliLoggedIn: true }), true), false);
  assert.equal(keyLoginShown(O, P({ connected: true }), true), false);
  assert.equal(keyLoginShown(O, P({ busy: true }), true), false);
  assert.equal(keyLoginShown(O, P(), false), false);
  assert.equal(cliLogoutShown(P({ cliLoggedIn: true }), true), true);
  assert.equal(cliLogoutShown(P({ cliLoggedIn: false }), true), false);
});
