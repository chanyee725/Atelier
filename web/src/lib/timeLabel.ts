// One time label for every screen (#889): relative inside the last 7 days ("방금", "5분 전", "3시간 전", "어제",
// "3일 전"), an absolute date after that ("11월 8일", or "2025년 11월 8일" in another year). Pure, local time.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Up to this many days back a time reads relative; older ones read as a date. */
export const RELATIVE_DAYS = 7;

/** Calendar days between two times in local time (0 = same day). */
function dayDiff(t: number, now: number): number {
  const a = new Date(t);
  const b = new Date(now);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / DAY);
}

/** "11월 8일", or "2025년 11월 8일" when the year is not this year's. */
export function dateLabel(t: number, now = Date.now()): string {
  const d = new Date(t);
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

/**
 * The label for a past time `t` (ms since epoch) seen at `now`. 0, NaN or a missing time gives "—". A time a little
 * in the future (clock skew) reads "방금".
 */
export function timeLabel(t: number | null | undefined, now = Date.now()): string {
  if (!t || !Number.isFinite(t)) return '—';
  const d = Math.max(0, now - t);
  if (d < MIN) return '방금';
  if (d < 60 * MIN) return `${Math.floor(d / MIN)}분 전`;
  const days = dayDiff(t, now);
  if (d < 24 * 60 * MIN && days === 0) return `${Math.floor(d / (60 * MIN))}시간 전`;
  if (days <= 1) return d < 12 * 60 * MIN ? `${Math.floor(d / (60 * MIN))}시간 전` : '어제';
  if (days <= RELATIVE_DAYS) return `${days}일 전`;
  return dateLabel(t, now);
}

/** The full local date and time, for a title or `<time>` tooltip: "2026년 11월 8일 14:05". */
export function fullTimeLabel(t: number): string {
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
}
