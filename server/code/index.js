// Read-only code API (E504b, issue #450): GET /api/code?path=&start=&end= returns a window of lines from a file of
// the git project that holds the workspace, for the "기능 코드" panel. Never writes, caches or logs file content.
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ownGitEnv, runCli } from '../dispatch/cli.js';
import { findProject } from '../dispatch/project.js';
import { gitTop } from '../dispatch/index.js';
import { sendJson } from '../app.js';

export const MAX_BYTES = 1024 * 1024;
export const MAX_WINDOW = 400;
export const CONTEXT = 20;
const SNIFF = 8192;

const LANGUAGES = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', md: 'markdown', html: 'html', css: 'css', scss: 'scss',
  sql: 'sql', xml: 'xml', vue: 'vue', svelte: 'svelte', lua: 'lua', r: 'r', dart: 'dart',
};
export const languageOf = (file) => LANGUAGES[path.extname(file).slice(1).toLowerCase()] ?? 'text';

// Segments that are never served: git internals, Dispatch state, env files and key/secret material.
const SECRET_SEGMENT = /^(\.git|\.dispatch|\.env.*|.*\.pem|.*\.key|id_rsa.*|.*\.p12|.*\.pfx|\.npmrc|\.netrc|credentials.*|secrets.*)$/i;
const isSecret = (segments) => segments.some((s) => SECRET_SEGMENT.test(s));

/** Normalised '/'-separated repo-relative path, or null for absolute, '..', NUL, backslash or empty input. */
export function cleanPath(raw) {
  if (typeof raw !== 'string' || !raw || raw.includes('\0') || raw.includes('\\') || raw.startsWith('/')) return null;
  const parts = raw.split('/').filter((s) => s && s !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

const toInt = (v) => (v == null || v === '' ? null : /^\d{1,9}$/.test(v) ? Number(v) : NaN);

/** Window of lines around [start, end] (1-based, inclusive): up to CONTEXT extra lines each side, <= MAX_WINDOW, clamped. */
export function windowOf(total, start, end) {
  const last = Math.min(Math.max(end, start), total, start + MAX_WINDOW - 1);
  const ctx = Math.min(CONTEXT, Math.floor((MAX_WINDOW - (last - start + 1)) / 2));
  const from = Math.max(1, start - ctx);
  const to = Math.min(total, last + ctx);
  return { start: from, end: to };
}

// Git-tracked files only (keeps gitignored config, node_modules/ and .dispatch/wt/ out). No shell; literal pathspec.
async function isTracked(root, rel) {
  try {
    await runCli('git', ['-C', root, '--literal-pathspecs', 'ls-files', '--error-unmatch', '--', rel], { env: ownGitEnv() });
    return true;
  } catch {
    return false;
  }
}

async function readGuarded(root, rel) {
  const segments = rel.split('/');
  if (isSecret(segments)) return { status: 403, error: 'forbidden' };
  let real;
  try {
    real = await realpath(path.join(root, rel));
  } catch {
    return { status: 404, error: 'not found' };
  }
  const inside = path.relative(root, real);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return { status: 403, error: 'forbidden' };
  if (isSecret(inside.split(path.sep))) return { status: 403, error: 'forbidden' };
  let fh;
  try {
    fh = await open(real, 'r');
    const st = await fh.stat();
    if (st.isDirectory()) return { status: 400, error: 'is a directory' };
    if (!st.isFile()) return { status: 404, error: 'not a file' };
    // Both the requested path and its realpath target must be tracked, so a tracked symlink cannot expose an
    // ignored or untracked file.
    if (!(await isTracked(root, rel))) return { status: 404, error: 'not-tracked' };
    const realRel = inside.split(path.sep).join('/');
    if (realRel !== rel && !(await isTracked(root, realRel))) return { status: 404, error: 'not-tracked' };
    if (st.size > MAX_BYTES) return { status: 413, error: 'file too large' };
    const buf = await fh.readFile();
    if (buf.subarray(0, SNIFF).includes(0)) return { status: 415, error: 'binary file' };
    return { text: buf.toString('utf8') };
  } catch {
    return { status: 404, error: 'not found' };
  } finally {
    await fh?.close();
  }
}

export async function setup(ctx, deps = {}) {
  const found = await findProject(ctx.workspaceDir, { gitTop: deps.gitTop ?? gitTop });
  const root = found.root;
  return {
    routes: [{
      method: 'GET',
      path: '/api/code',
      async handler(req, res, _ctx, _m, url) {
        if (!root) return sendJson(res, 404, { error: 'no-project' });
        const rawPath = url.searchParams.get('path');
        // searchParams decoded once already: a '%' left over means double encoding.
        const rel = rawPath?.includes('%') ? null : cleanPath(rawPath);
        const start = toInt(url.searchParams.get('start'));
        const endRaw = toInt(url.searchParams.get('end'));
        if (!rel || Number.isNaN(start) || Number.isNaN(endRaw) || start === 0 || endRaw === 0 || (start != null && endRaw != null && endRaw < start)) {
          return sendJson(res, 400, { error: 'bad request' });
        }
        const out = await readGuarded(root, rel);
        if (out.error) return sendJson(res, out.status, { error: out.error });
        const all = out.text.split('\n');
        if (all.length && all[all.length - 1] === '') all.pop();
        const total = all.length;
        const from = start ?? 1;
        if (start != null && start > total) return sendJson(res, 416, { error: 'range outside file' });
        const wanted = Math.min(endRaw ?? (start == null ? total : from), total);
        const w = windowOf(total, from, wanted);
        res.setHeader('cache-control', 'no-store');
        return sendJson(res, 200, {
          path: rel,
          start: w.start,
          end: w.end,
          total,
          lines: all.slice(w.start - 1, w.end).map((l) => l.replace(/\r$/, '')),
          language: languageOf(rel),
          ...(wanted - from + 1 > MAX_WINDOW && { truncated: true }),
        });
      },
    }],
  };
}
