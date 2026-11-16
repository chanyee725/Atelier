// Keeps an outside code change (an agent write applied in place) apart from a user edit in the code panel:
// the sync dispatch carries the `external` annotation and the change listener skips it, so it is never saved back.
import { Annotation, Transaction, type TransactionSpec, type EditorState } from '@codemirror/state';

export const external = Annotation.define<boolean>();

/** The transaction spec that replaces the whole text with `code`, or null when it already matches. */
export function syncSpec(state: EditorState, code: string): TransactionSpec | null {
  if (state.doc.toString() === code) return null;
  return { changes: { from: 0, to: state.doc.length, insert: code }, annotations: [external.of(true), Transaction.addToHistory.of(false)] };
}

/** The new text when the update came from the user (or null when nothing changed or it was an outside sync). */
export function userCode(u: { docChanged: boolean; transactions: readonly Transaction[]; state: EditorState }): string | null {
  if (!u.docChanged) return null;
  if (!u.transactions.some((t) => t.docChanged && !t.annotation(external))) return null;
  return u.state.doc.toString();
}
