// Plan diagram look (#971): a plan block is a plain flowchart, so it has no icons or colours of its own. When it is
// drawn (canvas and document), each step node gets its role's icon and colour and every node a flat box
// (`styleMode: plain`), like the #945 preview. Only the drawn code changes; the saved code stays as written.
// Pure, so it runs under `node --test`.
import { parse, type GraphChild, type GraphDiagram } from '../../../shared/dsl/index.ts';
import type { Plan } from '../../../shared/dispatch/plan.ts';

/** Role → bundled Lucide icon and the DSL palette name closest to the role's `--role-*` token. */
export const ROLE_LOOK: Readonly<Record<string, { icon: string; color: string }>> = {
  lead: { icon: 'compass', color: 'purple' },
  impl: { icon: 'code-xml', color: 'blue' },
  review: { icon: 'eye', color: 'orange' },
  test: { icon: 'flask-conical', color: 'green' },
  design: { icon: 'palette', color: 'pink' },
  docs: { icon: 'file-text', color: 'gray' },
  merge: { icon: 'git-merge', color: 'cyan' },
};

/** Node name → role, for the steps of `plan` (a step's role, else the plan default). */
export function planRoles(plan: Pick<Plan, 'steps' | 'defaults'> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of plan?.steps ?? []) {
    const role = s.role ?? plan?.defaults?.role;
    if (role) out[s.node || s.id] = role;
  }
  return out;
}

/** A stable key for the roles, for picture caches (drawSig, fileId). */
export const rolesKey = (roles: Readonly<Record<string, string>>): string =>
  Object.keys(roles).sort().map((k) => `${k}=${roles[k]}`).join(',');

function nodesOf(children: readonly GraphChild[], out: GraphChild[] = []): GraphChild[] {
  for (const ch of children) {
    if (ch.kind === 'node') out.push(ch);
    else nodesOf(ch.children, out);
  }
  return out;
}

/**
 * `code` with each node's look written into the line that names it first (its declaration, or the connection that
 * created it): `[icon, color, styleMode: plain]` added after the name, or put first inside its `[...]`. Attributes the
 * node already has win. The line count and every other line stay the same, so diagnostics and code links still match.
 * Code that is not a flowchart or architecture graph comes back unchanged.
 */
export function decorateCode(code: string, type: string, roles: Readonly<Record<string, string>>): string {
  // Block types say `architecture`; the parser says `cloud-architecture`.
  const kind = type === 'architecture' ? 'cloud-architecture' : type;
  if (kind !== 'flowchart' && kind !== 'cloud-architecture') return code;
  const { ast } = parse(code, kind);
  if (ast.type !== 'flowchart' && ast.type !== 'cloud-architecture') return code;
  const lines = code.split('\n');
  // Edits per line, applied right to left so earlier columns stay valid.
  const edits = new Map<number, { col: number; text: string }[]>();
  for (const n of nodesOf((ast as GraphDiagram).children)) {
    const look = Object.hasOwn(roles, n.name) ? ROLE_LOOK[roles[n.name]!] : undefined;
    const add: string[] = [];
    if (look && n.attrs.icon === undefined) add.push(`icon: ${look.icon}`);
    if (look && n.attrs.color === undefined) add.push(`color: ${look.color}`);
    if (n.attrs.styleMode === undefined) add.push('styleMode: plain');
    if (!add.length) continue;
    const text = lines[n.span.line - 1];
    if (text === undefined) continue;
    const end = n.span.column - 1 + n.span.length;
    const open = /^\s*\[/.exec(text.slice(end));
    const edit = open ? { col: end + open[0].length, text: `${add.join(', ')}, ` } : { col: end, text: ` [${add.join(', ')}]` };
    const list = edits.get(n.span.line - 1) ?? [];
    list.push(edit);
    edits.set(n.span.line - 1, list);
  }
  for (const [i, list] of edits) {
    let t = lines[i]!;
    for (const e of list.sort((a, b) => b.col - a.col)) t = t.slice(0, e.col) + e.text + t.slice(e.col);
    lines[i] = t;
  }
  return lines.join('\n');
}

/** The plan look a file's diagrams are drawn with: which block is the plan and its node roles. */
export type PlanLook = { block: string; roles: Readonly<Record<string, string>> };

/** The look of `plan`, or null when the file has none. */
export const planLookOf = (plan: Pick<Plan, 'block' | 'steps' | 'defaults'> | null | undefined): PlanLook | null =>
  plan ? { block: plan.block, roles: planRoles(plan) } : null;

/** A key that changes when the look does, for memos and picture caches. */
export const lookKey = (look: PlanLook | null | undefined): string => (look ? `${look.block}|${rolesKey(look.roles)}` : '');

const decorated = new Map<string, string>();

/**
 * The block as it is drawn: the plan block with its code decorated (`decorateCode`), any other block as it is.
 * Use it wherever the code is drawn or laid out, so pictures, layout sessions and caches all see the same code;
 * never write its code back.
 */
export function drawnBlock<B extends { id: string; type: string; code: string }>(b: B, look: PlanLook | null | undefined): B {
  if (!look || b.id !== look.block) return b;
  const key = `${b.type}\n${rolesKey(look.roles)}\n${b.code}`;
  let code = decorated.get(key);
  if (code === undefined) {
    code = decorateCode(b.code, b.type, look.roles);
    decorated.set(key, code);
    if (decorated.size > 50) decorated.delete(decorated.keys().next().value!);
  }
  return code === b.code ? b : { ...b, code };
}
