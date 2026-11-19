// Icon picker logic (#734): search the bundled icon names and write the picked icon into the code.
// Pure functions, so they can be tested without a DOM.

import type { PackSet } from '../../../shared/render/icon-registry.ts';

export interface IconEntry {
  name: string;
  set: PackSet;
  key: string;
  title?: string;
}

/** Shown before anything is typed. */
export const SUGGESTED = [
  'aws-ec2', 'aws-lambda', 'aws-s3', 'aws-rds', 'aws-dynamodb', 'aws-sqs', 'aws-api-gateway', 'aws-cloudfront',
  'azure-virtual-machine', 'azure-function-apps', 'azure-sql-database', 'azure-cosmos-db',
  'gcp-compute-engine', 'gcp-cloud-run', 'gcp-cloud-sql', 'gcp-bigquery',
  'postgres', 'mysql', 'redis', 'mongodb', 'docker', 'kubernetes', 'nginx', 'github',
  'users', 'user', 'server', 'database', 'globe', 'lock', 'mail', 'smartphone',
];

export const SET_LABEL: Record<PackSet, string> = { aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud', simple: '로고', lucide: '일반' };

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Best matches for a query, at most `limit`. Every query word must appear in the name or title. Exact names first,
 * then names starting with the query, then word starts, then anything containing it; shorter names first within each.
 * One entry per icon (aliases of an icon already listed are skipped).
 */
export function searchIcons(entries: readonly IconEntry[], query: string, limit = 60): IconEntry[] {
  const q = norm(query);
  if (!q) {
    const byName = new Map(entries.map((e) => [e.name, e]));
    return SUGGESTED.map((n) => byName.get(n)).filter((e): e is IconEntry => !!e).slice(0, limit);
  }
  const words = q.split(' ');
  const joined = q.replace(/ /g, '-');
  const scored: [number, IconEntry][] = [];
  for (const e of entries) {
    const name = e.name;
    const hay = `${norm(name)} ${e.title ? norm(e.title) : ''}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const score = name === joined ? 0 : name.startsWith(joined) ? 1 : ` ${hay}`.includes(` ${words[0]}`) ? 2 : 3;
    scored.push([score * 1000 + name.length, e]);
  }
  scored.sort((a, b) => a[0] - b[0] || (a[1].name < b[1].name ? -1 : 1));
  const seen = new Set<string>();
  const out: IconEntry[] = [];
  for (const [, e] of scored) {
    const id = `${e.set}:${e.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** The part of a line before a `//` comment that is outside quotes. */
function splitComment(line: string): [string, string] {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '/' && line[i + 1] === '/') return [line.slice(0, i), line.slice(i)];
  }
  return [line, ''];
}

/** Top-level setting lines (`direction right`, `title ...`): they never take an icon. */
const GLOBAL_LINE = /^(title|direction|colorMode|styleMode|typeface|textSize|wrap|connectorStyle|nodeStyle|autoIcons|legend|notation|autoNumber)\b/;

/** A connection line (`A > B`, `A -- B`): a connection symbol outside brackets and quotes. */
function isConnection(code: string): boolean {
  const bare = code.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\[[^\]]*\]/g, '');
  return /[<>]/.test(bare) || /\s--?\s/.test(bare);
}

/**
 * Put `icon: <name>` on the node or group declared on line `line` (0-based): replace its icon, add it to its
 * `[ ... ]`, or add `[icon: <name>]` before a group's `{`. A blank line, a line out of range or a connection line
 * gets a new node line `<name> [icon: <name>]` (after the cursor line). Returns the new code and the edited line.
 */
export function setLineIcon(code: string, line: number, name: string): { code: string; line: number } {
  const eol = /\r\n/.test(code) ? '\r\n' : '\n';
  const lines = code.split(/\r?\n/);
  const raw = lines[line];
  const [body, comment] = raw === undefined ? ['', ''] : splitComment(raw);
  const trimmed = body.trim();
  const blankOrEdge = raw === undefined || !trimmed || trimmed === '}' || GLOBAL_LINE.test(trimmed) || isConnection(body);
  if (blankOrEdge) {
    const indent = raw === undefined ? '' : (/^\s*/.exec(raw)![0] ?? '');
    const node = `${indent}${name} [icon: ${name}]`;
    if (raw !== undefined && !trimmed) {
      lines[line] = node;
      return { code: lines.join(eol), line };
    }
    const at = raw === undefined ? lines.length : line + 1;
    lines.splice(at, 0, node);
    return { code: lines.join(eol), line: at };
  }
  let next: string;
  const bracket = /\[([^\]]*)\]/.exec(body);
  if (bracket) {
    const inner = bracket[1]!;
    const replaced = inner.replace(/(^|,)(\s*)icon\s*:\s*("[^"]*"|'[^']*'|[^,]*)/, (_, lead: string, sp: string) => `${lead}${sp}icon: ${name}`);
    const nextInner = replaced !== inner ? replaced : inner.trim() ? `icon: ${name}, ${inner.trimStart()}` : `icon: ${name}`;
    next = body.slice(0, bracket.index) + `[${nextInner}]` + body.slice(bracket.index + bracket[0].length);
  } else {
    const brace = body.lastIndexOf('{');
    if (brace >= 0) next = `${body.slice(0, brace).trimEnd()} [icon: ${name}] ${body.slice(brace)}`;
    else next = `${body.trimEnd()} [icon: ${name}]${comment ? ' ' : ''}`;
  }
  lines[line] = next + comment;
  return { code: lines.join(eol), line };
}
