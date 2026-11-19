// Plan steps with an open in-document question (#738): the run views show them as blocked (#687) until answered.
import { useMemo } from 'react';
import { askingSteps } from '../../../shared/dispatch/discussions.ts';
import type { FileSession } from '../fileSession';
import { useSession } from '../useSession';

/** A Set that keeps its identity while the asking steps stay the same (the run model memoizes on it). */
export function useAskingSteps(session: FileSession): ReadonlySet<string> {
  const key = useSession(session, (s) => [...askingSteps(s.file?.discussions)].sort().join('\n'));
  return useMemo(() => new Set(key ? key.split('\n') : []), [key]);
}
