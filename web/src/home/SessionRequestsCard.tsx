// 세션 요청 (#880): the dashboard card that lists what agent sessions asked a person for — 계획 승인, 권한 요청, 질문,
// 사람 기다림 (sessionRequests.ts) — one row each: the session's model mark and name, the request, and since when.
// A row goes where the 확인하기 on a plan goes: a plan opens with its 시작하기 confirm, a session opens on the 세션 보드.
// Takes the place of 사용량 설정 on the dashboard for now (the sidebar shows model usage). Quiet: the dashboard's <Card>
// and <CardRow>, no accent of its own.
import { useMemo } from 'react';
import { Bot } from 'lucide-react';
import type { Session } from '../../../shared/dispatch/types.ts';
import { usePermissionAsks } from '../activity/permissionAsksStore';
import { REQUEST_LABEL, sessionRequests, type SessionRequest } from '../activity/sessionRequests.ts';
import { useWaitingPlans } from '../activity/waitingPlans';
import { useNow } from '../dispatch/AttentionStrip';
import { providerIcon, ProviderIcon } from '../ProviderIcon';
import { requestPlanConfirm } from '../run/planConfirmRequest';
import { Card, CardList, CardRow, EmptyState } from './dash';
import { relativeTime } from './model';

type Props = {
  /** The project's sessions (the dashboard's own feed); not an array while loading or failed. */
  sessions: Session[] | 'failed' | null;
  /** '' = the whole project. */
  folder: string;
  onOpen: (path: string) => void;
  onSession?: (id: string) => void;
};

export function SessionRequestsCard({ sessions, folder, onOpen, onSession }: Props) {
  const plans = useWaitingPlans();
  const asks = usePermissionAsks();
  const now = useNow();
  const list = useMemo(() => sessionRequests(plans, asks, Array.isArray(sessions) ? sessions : null, folder), [plans, asks, sessions, folder]);
  const go = (r: SessionRequest) => {
    if ('plan' in r.target) {
      // The plan's own strip opens its confirm once the document is loaded (same as 확인하기).
      requestPlanConfirm(r.target.plan);
      onOpen(r.target.plan);
    } else onSession?.(r.target.session);
  };
  return (
    // As tall as its rows up to 20rem, then the rows scroll inside: the tabbed card below keeps the rest of the column.
    <Card id="session-requests" title="세션 요청" count={list.length} flush scroll className="max-h-80 shrink-0">
      {list.length === 0 ? (
        <EmptyState>기다리는 요청이 없어요.</EmptyState>
      ) : (
        <CardList label="세션 요청">
          {list.map((r) => (
            <CardRow
              key={r.key}
              data={r.key}
              icon={providerIcon(r.provider) ? <ProviderIcon provider={r.provider} /> : <Bot />}
              title={r.session ?? '세션'}
              sub={`${REQUEST_LABEL[r.kind]} · ${r.text}`}
              meta={r.at ? <time dateTime={new Date(r.at).toISOString()}>{relativeTime(r.at, now)}</time> : null}
              onClick={'plan' in r.target || onSession ? () => go(r) : undefined}
            />
          ))}
        </CardList>
      )}
    </Card>
  );
}
