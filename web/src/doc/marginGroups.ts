// Grouping and overflow of the document's agent area (#727): many agents (a pipeline runs several writers and
// reviewers on one document set) fit as compact rows grouped by role, with at most ROWS_MAX rows until the user asks
// for all of them. Pure (no React or DOM), so it runs under `node --test`.
import { ROLES, roleLabel } from '../run/overlayModel.ts';

/** Rows shown before "+N명 더 보기". */
export const ROWS_MAX = 6;
/** Agent dots on the collapsed rail and the collapsed sheet bar before "+N". */
export const DOTS_MAX = 6;

/** Roles in the order a pipeline runs them; others follow in the order they came. */
const ROLE_ORDER: readonly string[] = ['lead', 'merge', 'design', 'impl', 'review', 'test', 'docs'];

type Groupable = { sid: string; role: string; roleName?: string };

export type MarginGroup<T> = {
  role: string;
  /** "구현자" (the role's own name, else the session's role name, else "기타"). */
  label: string;
  /** Agents of this role, in the order they came. */
  all: T[];
  /** The rows shown now (a prefix of `all`, plus a kept agent). */
  shown: T[];
  /** How many of `all` are not shown. */
  hidden: number;
};

export type MarginLayout<T> = {
  groups: MarginGroup<T>[];
  /** Rows not shown, over all groups. */
  hidden: number;
  /** Showing everything would change something (the "줄이기" button). */
  overflows: boolean;
};

const rank = (role: string) => {
  const i = ROLE_ORDER.indexOf(role);
  return i < 0 ? ROLE_ORDER.length : i;
};

/**
 * Group `cards` by role and pick the rows to show. Collapsed (`expanded` false), at most `max` rows, shared round-robin
 * so every role keeps a row; `keep` (the agent whose details are open) always shows. When only one row would be
 * hidden, it shows instead of a "+1" of the same size.
 */
export function layoutAgents<T extends Groupable>(cards: readonly T[], opts: { expanded?: boolean; max?: number; keep?: string | null } = {}): MarginLayout<T> {
  const max = Math.max(1, opts.max ?? ROWS_MAX);
  const byRole = new Map<string, T[]>();
  for (const c of cards) {
    const key = c.role || '';
    const list = byRole.get(key);
    if (list) list.push(c);
    else byRole.set(key, [c]);
  }
  // Stable: known roles by pipeline order, the rest in the order they came (Map keeps insertion order).
  const roles = [...byRole.keys()].map((role, i) => ({ role, i })).sort((a, b) => rank(a.role) - rank(b.role) || a.i - b.i);
  const overflows = cards.length > max + 1;
  const all = !overflows || opts.expanded;
  const take = new Map<string, number>(roles.map(({ role }) => [role, all ? byRole.get(role)!.length : 0]));
  if (!all) {
    // Round-robin: one row per role per pass, until `max` rows are taken.
    let left = max;
    while (left > 0) {
      let took = false;
      for (const { role } of roles) {
        if (left === 0) break;
        if (take.get(role)! < byRole.get(role)!.length) {
          take.set(role, take.get(role)! + 1);
          left--;
          took = true;
        }
      }
      if (!took) break;
    }
  }
  let hidden = 0;
  const groups = roles.map(({ role }) => {
    const list = byRole.get(role)!;
    const n = take.get(role)!;
    const shown = list.filter((c, i) => i < n || (!!opts.keep && c.sid === opts.keep));
    hidden += list.length - shown.length;
    const label = (role in ROLES ? roleLabel(role) : list[0].roleName) || roleLabel(role) || '기타';
    return { role, label, all: list, shown, hidden: list.length - shown.length };
  });
  return { groups, hidden, overflows };
}

/** The first `max` items and how many more ("+N"); with one over, all of them (a dot beats a "+1"). */
export function capDots<T>(items: readonly T[], max = DOTS_MAX): { shown: readonly T[]; more: number } {
  if (items.length <= max + 1) return { shown: items, more: 0 };
  return { shown: items.slice(0, max), more: items.length - max };
}
