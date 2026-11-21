import { useMemo } from 'react';
import { lookKey, planLookOf, type PlanLook } from '../canvas/planStyle';
import type { FileSession } from '../fileSession';
import { useSession } from '../useSession';

/** The open file's plan look (#971), kept while only unrelated plan fields change. */
export function usePlanLook(session: FileSession): PlanLook | null {
  const plan = useSession(session, (s) => s.file?.plan);
  const look = planLookOf(plan);
  const key = lookKey(look);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => look, [key]);
}
