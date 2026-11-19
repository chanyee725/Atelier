// In-document questions between agents and the user (`discussions` in `.dpx.json`, format v6; issue #738).
// Shared like `plan` (shared/dispatch/plan.ts): the server checks every change with `discussionsProblem` /
// `cleanDiscussions`, and both sides count open questions with `openQuestions`.
// Stored: the question, its choices and the answer (document content), who asked / answered as a session name,
// "user" or "outside" only, the asking session's id, and times. Never a transcript, an email or a real name.

/** Sub-format version this code understands. A higher `v` is kept verbatim and not changed. */
export const DISCUSSIONS_VERSION = 1;
export const MAX_DISCUSSIONS = 500;
export const MAX_QUESTION = 2_000;
export const MAX_ANSWER = 4_000;
export const MAX_CHOICES = 10;
export const MAX_CHOICE = 200;
/** Longest id, block, node, step and session name. */
export const MAX_DISCUSSION_NAME = 200;
/** `answeredBy` when the person using the app answered. */
export const USER = 'user';
/** `askedBy` / `answeredBy` for an outside writer (a non-session `x-drawing-session` label is never stored). */
export const OUTSIDE = 'outside';

export type DiscussionAnchor =
  /** A block in the document or a diagram block, by id. */
  | { kind: 'block'; block: string }
  /** A text range of the document (editor positions, `from` < `to`). */
  | { kind: 'text'; from: number; to: number }
  /** A node of a diagram block. */
  | { kind: 'node'; block: string; node: string };

export interface Discussion {
  id: string;
  anchor: DiscussionAnchor;
  question: string;
  choices?: string[];
  status: 'open' | 'answered';
  /** Index into `choices` when one was picked. */
  choice?: number;
  /** Typed answer, or the picked choice's text. */
  answer?: string;
  /** Session name of the asking agent, or "outside". */
  askedBy: string;
  /** Session id of the asking agent: the answer goes to this session only (a later session may reuse the name). */
  askedById?: string;
  /** Plan step id the asking session works on; its step shows as blocked while the question is open. */
  step?: string;
  /** "user", "outside", or a session name. */
  answeredBy?: string;
  /** Epoch ms. */
  askedAt: number;
  answeredAt?: number;
}

export interface Discussions {
  v: number;
  items: Discussion[];
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isName = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= MAX_DISCUSSION_NAME;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length >= 1 && v.length <= max;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPos = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Why `a` is not a storable anchor, or null. */
export function anchorProblem(a: unknown, at = 'anchor'): string | null {
  if (!isObj(a)) return `${at} must be an object`;
  if (a.kind === 'block') return isName(a.block) ? null : `${at}.block must be a string of 1-${MAX_DISCUSSION_NAME} characters`;
  if (a.kind === 'node') {
    if (!isName(a.block)) return `${at}.block must be a string of 1-${MAX_DISCUSSION_NAME} characters`;
    return isName(a.node) ? null : `${at}.node must be a string of 1-${MAX_DISCUSSION_NAME} characters`;
  }
  if (a.kind === 'text') {
    if (!isPos(a.from) || !isPos(a.to) || (a.from as number) >= (a.to as number)) return `${at}.from and ${at}.to must be integers with 0 <= from < to`;
    return null;
  }
  return `${at}.kind must be block, text or node`;
}

/** Why `q` is not a storable question (new or stored), or null. */
export function questionProblem(q: Record<string, unknown>, at: string): string | null {
  const bad = anchorProblem(q.anchor, `${at}.anchor`);
  if (bad) return bad;
  if (!isText(q.question, MAX_QUESTION)) return `${at}.question must be a non-blank string of at most ${MAX_QUESTION} characters`;
  if (q.choices !== undefined) {
    if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > MAX_CHOICES) return `${at}.choices must be an array of 2-${MAX_CHOICES} entries`;
    if (!q.choices.every((c) => isText(c, MAX_CHOICE))) return `${at}.choices entries must be non-blank strings of at most ${MAX_CHOICE} characters`;
  }
  if (q.step !== undefined && !isName(q.step)) return `${at}.step must be a string of 1-${MAX_DISCUSSION_NAME} characters`;
  return null;
}

/**
 * Why `d` is not a storable `discussions` section, or null. `at` names it in the message.
 * A `v` above {@link DISCUSSIONS_VERSION} is only checked for being an object with an integer `v`.
 */
export function discussionsProblem(d: unknown, at = 'discussions'): string | null {
  if (!isObj(d)) return `${at} must be an object`;
  if (!Number.isInteger(d.v) || (d.v as number) < 1) return `${at}.v must be an integer >= 1`;
  if ((d.v as number) > DISCUSSIONS_VERSION) return null;
  if (!Array.isArray(d.items)) return `${at}.items must be an array`;
  if (d.items.length > MAX_DISCUSSIONS) return `${at}.items has more than ${MAX_DISCUSSIONS} entries`;
  const ids = new Set<string>();
  for (let i = 0; i < d.items.length; i++) {
    const q: unknown = d.items[i];
    const qat = `${at}.items[${i}]`;
    if (!isObj(q)) return `${qat} must be an object`;
    if (!isName(q.id)) return `${qat}.id must be a string of 1-${MAX_DISCUSSION_NAME} characters`;
    if (ids.has(q.id)) return `duplicate discussion id "${q.id.slice(0, 40)}"`;
    ids.add(q.id);
    const bad = questionProblem(q, qat);
    if (bad) return bad;
    if (!isName(q.askedBy)) return `${qat}.askedBy must be a string of 1-${MAX_DISCUSSION_NAME} characters`;
    if (q.askedById !== undefined && !isName(q.askedById)) return `${qat}.askedById must be a string of 1-${MAX_DISCUSSION_NAME} characters`;
    if (!isTime(q.askedAt)) return `${qat}.askedAt must be a time in ms`;
    if (q.status === 'open') continue;
    if (q.status !== 'answered') return `${qat}.status must be open or answered`;
    if (!isText(q.answer, MAX_ANSWER)) return `${qat}.answer must be a non-blank string of at most ${MAX_ANSWER} characters`;
    if (q.choice !== undefined && (!Array.isArray(q.choices) || !Number.isInteger(q.choice) || (q.choice as number) < 0 || (q.choice as number) >= q.choices.length)) {
      return `${qat}.choice must index ${qat}.choices`;
    }
    if (!isName(q.answeredBy)) return `${qat}.answeredBy must be a string of 1-${MAX_DISCUSSION_NAME} characters`;
    if (!isTime(q.answeredAt)) return `${qat}.answeredAt must be a time in ms`;
  }
  return null;
}

/** Copy of a section that passed {@link discussionsProblem}: unknown fields dropped. A newer `v` comes back as is. */
export function cleanDiscussions(d: Discussions): Discussions {
  if (d.v > DISCUSSIONS_VERSION) return d;
  return {
    v: d.v,
    items: d.items.map((q) => {
      const a = q.anchor;
      const anchor: DiscussionAnchor = a.kind === 'block' ? { kind: 'block', block: a.block } : a.kind === 'node' ? { kind: 'node', block: a.block, node: a.node } : { kind: 'text', from: a.from, to: a.to };
      const out: Discussion = { id: q.id, anchor, question: q.question, status: q.status, askedBy: q.askedBy, askedAt: q.askedAt };
      if (q.choices !== undefined) out.choices = [...q.choices];
      if (q.step !== undefined) out.step = q.step;
      if (q.askedById !== undefined) out.askedById = q.askedById;
      if (q.status === 'answered') {
        if (q.choice !== undefined) out.choice = q.choice;
        out.answer = q.answer;
        out.answeredBy = q.answeredBy;
        out.answeredAt = q.answeredAt;
      }
      return out;
    }),
  };
}

/** Open questions of a section (none for a missing or newer one). */
export function openQuestions(d: Discussions | null | undefined): Discussion[] {
  if (!d || d.v > DISCUSSIONS_VERSION || !Array.isArray(d.items)) return [];
  return d.items.filter((q) => q.status === 'open');
}

/** Plan step ids with an open question: those steps show as blocked (#687) until it is answered. */
export function askingSteps(d: Discussions | null | undefined): Set<string> {
  return new Set(openQuestions(d).flatMap((q) => (q.step ? [q.step] : [])));
}
