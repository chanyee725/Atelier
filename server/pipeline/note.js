// Pipeline section (note): note_step: one line a lead leaves on a running step.
// Moved out of index.js as is (#1000); `c` is the context setup builds.
import { StoreError } from '../workspace/store.js';
import { redact } from '../dispatch/redact.js';

export function createNote(c) {
  const { recorder, dispatch, leadEntries } = c;

  // ---- note_step ----
  function note(body) {
    if (!dispatch()) throw new StoreError(409, 'Dispatch가 꺼져 있어요');
    if (typeof body.lead !== 'string' || typeof body.step !== 'string') throw new StoreError(400, 'lead and step are required');
    const text = redact(String(body.text ?? '')).replace(/\s+/g, ' ').trim();
    if (!text) throw new StoreError(400, 'text가 비어 있어요');
    const running = leadEntries(body.lead, 'running').find(([, e]) => e.steps?.includes(body.step));
    if (!running) throw new StoreError(409, leadEntries(body.lead, 'running').length ? `승인된 계획에 단계 "${body.step.slice(0, 40)}"가 없어요` : '실행 중인 계획이 없어요');
    const [path, e] = running;
    return { path, step: body.step, note: recorder.noteStep(e.runId, body.step, text.slice(0, 200)) };
  }

  Object.assign(c, { note });
}
