// In-document questions (#738), the pure part: which questions the document shows, in what order, and the words
// around them. Stored names are a session name, "user" or "outside" only (shared/dispatch/discussions.ts).
import { DISCUSSIONS_VERSION, MAX_ANSWER, OUTSIDE, USER, type Discussion, type DiscussionAnchor, type Discussions } from '../../../shared/dispatch/discussions.ts';

export type QuestionLists = { open: Discussion[]; answered: Discussion[] };

/** Open questions oldest first (the first asked waits longest), answered ones newest first. A newer `v` shows none. */
export function questionLists(d: Discussions | null | undefined): QuestionLists {
  if (!d || d.v > DISCUSSIONS_VERSION || !Array.isArray(d.items)) return { open: [], answered: [] };
  const open = d.items.filter((q) => q.status === 'open').sort((a, b) => a.askedAt - b.askedAt);
  const answered = d.items.filter((q) => q.status === 'answered').sort((a, b) => (b.answeredAt ?? 0) - (a.answeredAt ?? 0));
  return { open, answered };
}

/** A stored asker / answerer as shown: the session name, 사용자 or 바깥 작성자. */
export function whoLabel(name: string | undefined): string {
  if (!name || name === OUTSIDE) return '바깥 작성자';
  if (name === USER) return '사용자';
  return name;
}

/** "답변됨 · 사용자" */
export const answeredLine = (q: Discussion) => `답변됨 · ${whoLabel(q.answeredBy)}`;

/** Where the question points. Questions are shown at document level; the anchor is named, not jumped to (yet). */
export function anchorLabel(a: DiscussionAnchor): string {
  if (a.kind === 'node') return `다이어그램 노드 ${a.node}`;
  if (a.kind === 'text') return '본문 일부';
  return a.block === 'doc' ? '문서' : '블록';
}

/** The answer to send: a picked choice wins, else the typed text; null when there is nothing to send. */
export function answerOf(q: Discussion, choice: number | null, text: string): { choice: number } | { text: string } | null {
  if (choice !== null && Array.isArray(q.choices) && Number.isInteger(choice) && choice >= 0 && choice < q.choices.length) return { choice };
  const t = text.trim();
  if (!t || t.length > MAX_ANSWER) return null;
  return { text: t };
}

/** Count text for the badges: "질문 2". */
export const questionCount = (n: number) => `질문 ${n}`;
