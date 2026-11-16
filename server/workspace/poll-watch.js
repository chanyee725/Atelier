// A stand-in for fs.watch(root, { recursive: true }, cb) that holds no inotify instance: it stats the tree on a
// timer and reports what differs. Used by the test harness (DRAW_WORKSPACE_WATCH=poll) so dozens of parallel
// servers do not exhaust the machine's inotify instance limit. Normal runs keep the real fs.watch.
// TEST ONLY: every tick walks and stats the whole folder synchronously (default every 250 ms), blocking the
// event loop for that long. Fine for small scratch workspaces; never use it for a real workspace.
// It also never emits 'error', so the watcher restart path is covered by the fake-watcher tests in test/workspace.test.js.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function snapshot(root) {
  const seen = new Map();
  const walk = (abs, rel) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = join(abs, e.name);
      let st;
      try { st = statSync(p); } catch { continue; }
      seen.set(r, `${st.mtimeMs}:${st.size}:${st.isDirectory() ? 'd' : 'f'}`);
      if (e.isDirectory() && !e.name.startsWith('.')) walk(p, r);
    }
  };
  walk(root, '');
  return seen;
}

export function pollWatch(root, _opts, listener, intervalMs = 250) {
  let prev = snapshot(root);
  let closed = false;
  const timer = setInterval(() => {
    if (closed) return;
    const next = snapshot(root);
    for (const [rel, sig] of next) if (prev.get(rel) !== sig) listener('change', rel);
    for (const rel of prev.keys()) if (!next.has(rel)) listener('rename', rel);
    prev = next;
  }, intervalMs);
  timer.unref?.();
  return {
    on() { return this; },
    close() { closed = true; clearInterval(timer); },
  };
}
