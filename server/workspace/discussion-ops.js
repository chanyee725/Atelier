// Question / answer edits for /api/file/discussions (#738). Pure: the store applies them to what is on disk under its
// save lock, and the result is checked with the shared rules when the file is normalized.
import { randomUUID } from 'node:crypto';
import { ValidationError } from './model.js';
import { DISCUSSIONS_VERSION, MAX_ANSWER, USER, questionProblem } from '../../shared/dispatch/discussions.ts';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `discussions` with a new open question from `askedBy` (a session name). Returns { discussions, item }. */
export function addQuestion(discussions, body, askedBy, now = Date.now()) {
  if (!isObj(body)) throw new ValidationError('body must be a JSON object');
  const q = { anchor: body.anchor, question: typeof body.question === 'string' ? body.question.trim() : body.question, choices: body.choices, step: body.step };
  if (q.choices === undefined || q.choices === null) delete q.choices;
  else if (Array.isArray(q.choices)) q.choices = q.choices.map((c) => (typeof c === 'string' ? c.trim() : c));
  if (q.step === undefined || q.step === null) delete q.step;
  const bad = questionProblem(q, 'body');
  if (bad) throw new ValidationError(bad);
  const item = { id: `q_${randomUUID().slice(0, 8)}`, ...q, status: 'open', askedBy, askedAt: now };
  const d = discussions ?? { v: DISCUSSIONS_VERSION, items: [] };
  return { discussions: { ...d, items: [...d.items, item] }, item };
}

/**
 * `discussions` with question `body.id` answered by `answeredBy` ("user" or a session name): `body.choice` picks a
 * choice (its text is the answer), `body.text` types one. Returns { discussions, item }.
 */
export function answerQuestion(discussions, body, answeredBy = USER, now = Date.now()) {
  if (!isObj(body)) throw new ValidationError('body must be a JSON object');
  if (typeof body.id !== 'string') throw new ValidationError('id must be a string');
  const i = discussions?.items.findIndex((q) => q.id === body.id) ?? -1;
  if (i < 0) throw new ValidationError(`no question "${body.id.slice(0, 40)}"`);
  const q = discussions.items[i];
  if (q.status !== 'open') throw new ValidationError('this question is already answered');
  let answer;
  let choice;
  if (body.choice !== undefined && body.choice !== null) {
    if (!Array.isArray(q.choices) || !Number.isInteger(body.choice) || body.choice < 0 || body.choice >= q.choices.length) {
      throw new ValidationError('choice must index the question\'s choices');
    }
    choice = body.choice;
    answer = q.choices[choice];
  } else {
    answer = typeof body.text === 'string' ? body.text.trim() : '';
    if (!answer) throw new ValidationError('pick a choice or type an answer (text)');
    if (answer.length > MAX_ANSWER) throw new ValidationError(`text must be at most ${MAX_ANSWER} characters`);
  }
  const item = { ...q, status: 'answered', answer, answeredBy, answeredAt: now };
  if (choice !== undefined) item.choice = choice;
  const items = [...discussions.items];
  items[i] = item;
  return { discussions: { ...discussions, items }, item };
}
