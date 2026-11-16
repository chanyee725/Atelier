// Live list of agent sessions in the workspace: the first answer of GET /api/workspace/agents, then every `agents`
// snapshot on the shared event stream; a reconnect asks again so nothing is missed while the stream was down.
// null while loading; 'off' when this server has no agent feed (older server), so the panel can say so plainly.
import { useEffect, useState } from 'react';
import { events } from '../lib/events';
import { parseAgents, type AgentPresence } from './agents';

export function useAgents(): AgentPresence[] | 'off' | null {
  const [agents, setAgents] = useState<AgentPresence[] | 'off' | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    let streamed = false; // an event already came in: a late GET answer must not roll it back
    const load = () =>
      void fetch('/api/workspace/agents', { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : r.status === 404 ? 'off' : null), () => null)
        .then((d) => {
          if (ctl.signal.aborted || streamed) return;
          if (d === 'off') setAgents((old) => old ?? 'off');
          else if (d) setAgents(parseAgents(d));
          else setAgents((old) => old ?? []);
        });
    load();
    const offAgents = events.subscribeJson<unknown>('agents', (e) => {
      streamed = true;
      setAgents(parseAgents(e));
    });
    let first = true;
    const offOpen = events.onConnection((online) => {
      if (!online) return;
      if (first) first = false;
      else {
        streamed = false;
        load();
      }
    });
    return () => {
      ctl.abort();
      offAgents();
      offOpen();
    };
  }, []);
  return agents;
}
