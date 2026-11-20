// 최근 page (#889, Lists.dc.html): every document newest edit first, with its kind for the filter chips. Pure.
import type { ProjectDoc, ProjectInfo, RecentFile } from '../api';
import { allDocs, flatFiles } from './model.ts';

export type RecentKind = 'doc' | 'plan';
export type RecentFilter = 'all' | RecentKind;
export type RecentRow = RecentFile & { kind: RecentKind };

export const KIND_LABEL: Record<RecentKind, string> = { doc: '문서', plan: '계획' };
export const FILTERS: { id: RecentFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'doc', label: '문서' },
  { id: 'plan', label: '계획' },
];

/** flatFiles (newest edit first) with each row's kind: a plan document reads 계획, everything else 문서. */
export function recentRows(projects: ProjectInfo[], unfiled: ProjectDoc[]): RecentRow[] {
  const plans = new Set(allDocs(projects, unfiled).filter((p) => p.doc.plan).map((p) => p.doc.path));
  return flatFiles(projects, unfiled).map((f) => ({ ...f, kind: plans.has(f.path) ? 'plan' : 'doc' }));
}

export const filterRecent = (rows: RecentRow[], f: RecentFilter) => (f === 'all' ? rows : rows.filter((r) => r.kind === f));
