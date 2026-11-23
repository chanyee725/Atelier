// Talk to a document's lead from the chat dock (#1057). Like askIssue.ts: the document screen's 관리자와 대화 button
// calls askAboutDoc, the dock subscribes, opens on the document's lead (or the helper when it has none), pins the
// document card and puts a first message in the box for the person to send (no model call on click).
// Metadata only: path, title, the open-question count and the lead's session id and name.
import { useSyncExternalStore } from 'react';

export type DocLead = { id: string; name: string; modelLabel?: string | null };
/** `lead`: the document's live lead (GET /api/file/lead), null when it has none (the helper takes the talk). */
export type DocRequest = { path: string; title: string; open: number; lead: DocLead | null; seq: number };

let current: DocRequest | null = null;
let seq = 0;
const subs = new Set<() => void>();

export function askAboutDoc(doc: Omit<DocRequest, 'seq'>): void {
  current = { ...doc, seq: ++seq };
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
const read = () => current;
export const useDocRequest = () => useSyncExternalStore(subscribe, read, read);

/**
 * The first message, waiting in the box. To the lead: go through the document's open questions and decisions one by
 * one, put each answer into the body and drop what is decided (no "확인 필요" list at the end, #1056). To the helper:
 * the document has no lead, so propose one, and start on the open questions meanwhile.
 */
export function docAskText(path: string, hasLead: boolean): string {
  if (hasLead) return `${path} 문서 이야기예요. 열린 질문과 남은 결정을 하나씩 물어봐 주고, 답을 받으면 본문에 반영하고 정해진 항목은 지워 줘`;
  return `${path} 문서에 배정된 관리자가 없어요. 이 문서를 맡을 관리자를 제안해 주고, 그동안 열린 질문부터 같이 정리해 줘`;
}

/** Keeps the document in the talk: a message that does not name the pinned path gets it on a first line. */
export function withDocPath(text: string, path: string): string {
  if (!text || text.includes(path)) return text;
  return `[문서: ${path}]\n${text}`;
}

/** The button's accessible name: its visible text first (Label in Name), then the open-question count. */
export function docButtonLabel(open: number): string {
  return open > 0 ? `관리자와 대화, 열린 질문 ${open}개` : '관리자와 대화';
}

/** Where the talk goes, said on the card. */
export function docLeadLine(lead: DocLead | null): string {
  return lead ? `${lead.name} 관리자와 대화해요` : '배정된 관리자가 없어서 도우미가 받아요';
}
