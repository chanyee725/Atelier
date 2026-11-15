// Project (workspace top folder) scoping of the 세션 board. Pure: node --test loads it directly.
// The scope lives in the URL hash next to the view: `#timeline&folder=docs`; `folder=` with no value is 미분류,
// no folder part is 전체. A session's `folder` that is no longer a project (renamed, moved, deleted) counts as 미분류.
import { isOpen } from './format.ts';
import type { Session } from '../../../../shared/dispatch/types.ts';

/** 전체 = undefined, 미분류 = null, a project = its folder path. */
export type Scope = string | null | undefined;

export const UNFILED = '미분류';

/** The folder part of a hash ("#usage&folder=a%20b"), or undefined when there is none. */
export function folderOf(hash: string): Scope {
  const parts = hash.replace(/^#/, '').split('&');
  for (const p of parts) {
    if (p === 'folder' || p.startsWith('folder=')) {
      let v = '';
      try { v = decodeURIComponent(p.slice('folder='.length)); } catch { /* keep empty: 미분류 */ }
      return v === '' ? null : v;
    }
  }
  return undefined;
}

/** The view part of a hash: the first piece that is not `key=value`. */
export const viewPart = (hash: string): string => {
  const first = hash.replace(/^#/, '').split('&')[0] ?? '';
  return first.includes('=') || first === 'folder' ? '' : first;
};

/** Hash for a view and scope; '' when both are the defaults. */
export function hashWith(view: string, scope: Scope): string {
  const folder = scope === undefined ? '' : `folder=${encodeURIComponent(scope ?? '')}`;
  const parts = [view, folder].filter(Boolean);
  return parts.length ? `#${parts.join('&')}` : '';
}

/** The project a session counts for: its folder when that is a known project, else null (미분류). */
export const projectOf = (s: Pick<Session, 'folder'>, known: ReadonlySet<string>): string | null =>
  s.folder != null && known.has(s.folder) ? s.folder : null;

/** Sessions in a scope; 전체 keeps everything. */
export function inScope<T extends Pick<Session, 'folder'>>(sessions: readonly T[], scope: Scope, known: ReadonlySet<string>): T[] {
  return scope === undefined ? [...sessions] : sessions.filter(s => projectOf(s, known) === scope);
}

/** Open-session count per project (key null = 미분류). */
export function openCounts(sessions: readonly Pick<Session, 'folder' | 'status'>[], known: ReadonlySet<string>): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const s of sessions) if (isOpen(s)) m.set(projectOf(s, known), (m.get(projectOf(s, known)) ?? 0) + 1);
  return m;
}

/** A project home's sessions: those whose folder is the project's path, open ones first, then newest. */
export const sessionsOf = <T extends Pick<Session, 'folder' | 'status' | 'startedAt'>>(sessions: readonly T[], folder: string): T[] =>
  sessions.filter(s => s.folder === folder).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (b.startedAt ?? 0) - (a.startedAt ?? 0));

/** Folders the scope may be filed under: the project paths, plus a picked project itself until the list has arrived (a
 *  `#folder=` link must not show an empty board, or count everything as 미분류, before the first answer). */
export const knownFolders = (paths: readonly string[], scope: Scope, ready: boolean): Set<string> => {
  const k = new Set(paths);
  if (!ready && typeof scope === 'string') k.add(scope);
  return k;
};
