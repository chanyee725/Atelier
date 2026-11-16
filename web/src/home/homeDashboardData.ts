// Usage per provider (E545, #685), shared by the sidebar usage card (E548, #698). Every source is one the app
// already reads elsewhere; nothing new on the server, nothing stored. Metadata only: usage percentages.
//   - GET /api/limits + GET /api/state providers (same as 설정 > 사용 한도, #676)
// Reloads every 30 s while the page is visible, and at once when the server pushes `limits` or `providers`.
import { useEffect, useState } from 'react';
import { api, type ProviderLimits, type ProviderState } from '../api';
import { events } from '../lib/events';
import { usageGroups, type UsageEntry, type UsageGroup } from '../settings/model';
import { pollWhileVisible } from './model';

const POLL_MS = 30_000;

/** Connected providers with their usage windows; null while loading, 'failed' when either request failed. */
export function useUsage(): UsageGroup[] | 'failed' | null {
  const [groups, setGroups] = useState<UsageGroup[] | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all([api.limits(), api.providers()]).then(
        ([l, p]: [ProviderLimits, Record<string, ProviderState>]) => live && setGroups(usageGroups(l as Record<string, UsageEntry>, p)),
        () => live && setGroups((old) => (Array.isArray(old) ? old : 'failed')),
      );
    const stop = pollWhileVisible(load, POLL_MS);
    const offs = [events.subscribe('limits', load), events.subscribe('providers', load)];
    return () => {
      live = false;
      stop();
      offs.forEach((off) => off());
    };
  }, []);
  return groups;
}
