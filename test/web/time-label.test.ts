import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateLabel, fullTimeLabel, timeLabel } from '../../web/src/lib/timeLabel.ts';

// Local-time constructors keep the cases independent of the machine's time zone.
const now = new Date(2026, 10, 20, 15, 0).getTime();
const at = (mo: number, d: number, h = 12, mi = 0, y = 2026) => new Date(y, mo - 1, d, h, mi).getTime();

test('timeLabel: relative inside 7 days (#889)', () => {
  assert.equal(timeLabel(now - 20_000, now), '방금');
  assert.equal(timeLabel(now + 5_000, now), '방금', 'a little clock skew reads 방금');
  assert.equal(timeLabel(now - 9 * 60_000, now), '9분 전');
  assert.equal(timeLabel(at(11, 20, 13), now), '2시간 전');
  assert.equal(timeLabel(at(11, 20, 0, 5), now), '14시간 전', 'earlier the same day stays in hours');
  assert.equal(timeLabel(at(11, 19, 10), now), '어제');
  assert.equal(timeLabel(at(11, 17, 9), now), '3일 전');
  assert.equal(timeLabel(at(11, 13, 9), now), '7일 전');
});

test('timeLabel: just after midnight, late last night still reads in hours', () => {
  const early = new Date(2026, 10, 20, 1, 0).getTime();
  assert.equal(timeLabel(new Date(2026, 10, 19, 23, 0).getTime(), early), '2시간 전');
  assert.equal(timeLabel(new Date(2026, 10, 19, 9, 0).getTime(), early), '어제');
});

test('timeLabel: an absolute date after 7 days, with the year only when it differs', () => {
  assert.equal(timeLabel(at(11, 12, 9), now), '11월 12일');
  assert.equal(timeLabel(at(10, 29), now), '10월 29일');
  assert.equal(timeLabel(at(12, 30, 9, 0, 2025), now), '2025년 12월 30일');
  assert.equal(dateLabel(at(1, 2), now), '1월 2일');
});

test('timeLabel: a missing time is a dash', () => {
  assert.equal(timeLabel(0, now), '—');
  assert.equal(timeLabel(null, now), '—');
  assert.equal(timeLabel(undefined, now), '—');
  assert.equal(timeLabel(Number.NaN, now), '—');
});

test('fullTimeLabel: date and 24h time for tooltips', () => {
  assert.equal(fullTimeLabel(at(11, 8, 14, 5)), '2026년 11월 8일 14:05');
});
