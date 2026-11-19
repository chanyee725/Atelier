// Live branch rows (#792) from GET /api/branches/live: polled while the page is visible and reloaded soon after any
// session event (a commit, a switch, a finished turn), so the view moves without a page reload.
import { useEffect, useState } from 'react';
import { events } from '../lib/events';
import { pollWhileVisible } from '../home/model';
import type { LiveBranches } from './lib/liveBranches.ts';

const POLL_MS = 10_000;
const EVENT_GAP_MS = 5_000;

/** null while the first answer loads, 'failed' when it did not come; a failed reload keeps the rows already shown. */
export function useLiveBranches(): LiveBranches | 'failed' | null {
  const [data, setData] = useState<LiveBranches | 'failed' | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const load = () =>
      void fetch('/api/branches/live', { signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<LiveBranches>) : null), () => null)
        .then((d) => {
          if (ctl.signal.aborted) return;
          setData((old) => (d && Array.isArray(d.rows) ? d : old && old !== 'failed' ? old : 'failed'));
        });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, EVENT_GAP_MS);
    };
    const stop = pollWhileVisible(load, POLL_MS);
    const offs = ['session', 'removed'].map((t) => events.subscribeJson<unknown>(t, soon));
    return () => {
      ctl.abort();
      stop();
      offs.forEach((off) => off());
      if (timer) clearTimeout(timer);
    };
  }, []);
  return data;
}
