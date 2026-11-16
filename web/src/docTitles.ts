// The names the sidebar shows for documents, kept out of Sidebar.tsx so tests can import them.
import type { DocNode, ProjectsView } from './api';

export const displayName = (n: { name: string; title?: string }) => n.title || n.name.replace(/\.dpx\.json$/, '');

/** Path -> shown name of every document in the projects view (for the working agents' file line). */
export const titlesOf = (view: ProjectsView | null) => {
  const m = new Map<string, string>();
  const walk = (nodes: readonly DocNode[]) => {
    for (const n of nodes) {
      m.set(n.path, displayName(n));
      walk(n.children);
    }
  };
  for (const p of view?.projects ?? []) walk(p.docs);
  walk(view?.loose ?? []);
  return m;
};
