import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answeredAsk, askAboutIssue, issueAskText, readAskRequest } from '../../web/src/chat/lib/askIssue.ts';
import { hasTeam } from '../../web/src/home/issueStart.ts';
import type { Session } from '../../shared/dispatch/types.ts';

const issue = { number: 954, title: 'T', state: '열림', url: 'https://github.com/o/r/issues/954' };

test('askAboutIssue: asks by default, seq grows so the same issue opens the dock again', () => {
  askAboutIssue(issue);
  const a = readAskRequest()!;
  assert.deepEqual({ ...a, seq: 0 }, { issue, ask: true, partner: null, seq: 0 });
  askAboutIssue(issue, { ask: false, partner: 'lead-1' });
  const b = readAskRequest()!;
  assert.equal(b.ask, false);
  assert.equal(b.partner, 'lead-1');
  assert.ok(b.seq > a.seq);
});

test('issueAskText asks for a proposal and says not to start', () => {
  const t = issueAskText(954);
  assert.match(t, /^#954 이슈를 읽고/);
  assert.match(t, /범위, 팀 구성/);
  assert.match(t, /아직 시작하지 마$/);
});

test('answeredAsk: only an assistant entry after the ask counts', () => {
  const ask = { kind: 'user', text: issueAskText(7) };
  const reply = { kind: 'assistant', text: '제안' };
  assert.equal(answeredAsk(undefined, 7), false);
  assert.equal(answeredAsk([reply], 7), false, 'an old reply without the ask');
  assert.equal(answeredAsk([reply, ask], 7), false, 'asked, no answer yet');
  assert.equal(answeredAsk([ask, { kind: 'tool', text: 'gh' }, reply], 7), true);
  assert.equal(answeredAsk([ask, reply, { kind: 'user', text: issueAskText(7) }], 7), false, 'asked again, waiting');
  assert.equal(answeredAsk([{ kind: 'user', text: issueAskText(8) }, reply], 7), false, 'another issue');
});

test('hasTeam: an open session or an open PR', () => {
  const s = (status: string) => ({ status }) as unknown as Session;
  assert.equal(hasTeam({ sessions: [], prs: [] }), false);
  assert.equal(hasTeam({ sessions: [s('done')], prs: [{ state: 'merged' }] }), false);
  assert.equal(hasTeam({ sessions: [s('idle')], prs: [] }), true);
  assert.equal(hasTeam({ sessions: [], prs: [{ state: 'open' }] }), true);
});
