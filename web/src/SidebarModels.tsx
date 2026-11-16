// Sidebar model rows (E525, #570), ported from Dispatch's Sidebar provider list: one row per entry in PROVIDERS
// (modelConnect.ts, keyed by provider id; only Claude for now, #587 adds more), each with a status dot and its text
// (설치 안 됨 / 로그인 중 / 5-hour usage / 연결 안 됨). A row opens the 모델 연결 dialog for that provider
// (ConnectDialog.tsx), where connect, cancel and disconnect happen. State comes from GET /api/state and the
// `providers` SSE event (docs/design/model-connection-contract.md). Nothing here reads credentials or logs anything.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DispatchStatus, type ProviderLimits, type ProviderState } from './api';
import { ConnectDialog } from './ConnectDialog';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from './components/ui/sidebar';
import { events } from './lib/events';
import { cn } from './lib/utils';
import { PROVIDERS, rowStatus, type ProviderMeta, type RowTone } from './modelConnect';
import { MODELS_CHANGED } from './settings/context';
import { pollLogins } from './settings/model';

const DOT: Record<RowTone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-destructive', off: 'bg-muted-foreground' };

export type Models = {
  status: DispatchStatus | null;
  /** State per provider id, as the server reports it. */
  providers: Record<string, ProviderState>;
  limits: ProviderLimits;
  reload: () => Promise<void>;
};

/** Provider state and usage. Live through the `providers` event; reloads on reconnect, on MODELS_CHANGED and every minute. */
export function useModels(): Models {
  const [status, setStatus] = useState<DispatchStatus | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderState>>({});
  const [limits, setLimits] = useState<ProviderLimits>({});
  const reload = useCallback(async () => {
    try {
      const s = await api.dispatch();
      setStatus(s);
      if (!s.enabled) return;
      const [pv, lim] = await Promise.all([api.providers(), api.limits().catch(() => ({}))]);
      setProviders(pv);
      setLimits(lim);
    } catch {
      setStatus({ enabled: false });
    }
  }, []);
  useEffect(() => {
    void reload();
    const t = setInterval(reload, 60_000);
    window.addEventListener(MODELS_CHANGED, reload);
    const offProviders = events.subscribeJson<Record<string, ProviderState>>('providers', (pv) => pv && typeof pv === 'object' && setProviders(pv));
    const offLimits = events.subscribe('limits', () => void api.limits().then(setLimits, () => {}));
    // After a dropped connection the events in between are lost: read the state again.
    let first = true;
    const offConn = events.onConnection((up) => {
      if (up && !first) void reload();
      if (up) first = false;
    });
    return () => {
      clearInterval(t);
      window.removeEventListener(MODELS_CHANGED, reload);
      offProviders();
      offLimits();
      offConn();
    };
  }, [reload]);
  // Fallback while a CLI login runs (the event stream may be down): check back every 2 s, give up after 10 minutes.
  const busy = Object.values(providers).some((p) => p?.busy);
  useEffect(() => (busy ? pollLogins(() => void reload(), () => {}) : undefined), [busy, reload]);
  return { status, providers, limits, reload };
}

export function SidebarModels() {
  const models = useModels();
  if (!models.status) return null;
  return (
    <SidebarMenu aria-label="모델 연결">
      {PROVIDERS.map((meta) => (
        <ModelRow key={meta.id} meta={meta} models={models} />
      ))}
    </SidebarMenu>
  );
}

function ModelRow({ meta, models }: { meta: ProviderMeta; models: Models }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const s = rowStatus(meta, models.providers[meta.id], !!models.status?.enabled, models.limits);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        ref={trigger}
        data-testid="model-row"
        data-provider={meta.id}
        data-state-key={s.key}
        aria-haspopup="dialog"
        aria-label={`${meta.name} ${s.text}, 연결 관리`}
        title={`${meta.name}: ${s.text}`}
        onClick={() => setOpen(true)}
        className="max-md:h-11"
      >
        {/* Same 17px slot as the nav icons, so the name lines up with 모든 파일, 최근, 보관함. */}
        <span aria-hidden className="grid size-[17px] shrink-0 place-items-center">
          <i className={cn('size-2 rounded-full', DOT[s.tone])} />
        </span>
        <span className="truncate">{meta.name}</span>
        <span className={cn('ml-auto shrink-0 text-xs tabular-nums', s.tone === 'warn' || s.tone === 'bad' ? 'text-foreground' : 'text-muted-foreground')}>{s.text}</span>
      </SidebarMenuButton>
      {open && (
        <ConnectDialog
          meta={meta}
          models={models}
          onClose={() => {
            setOpen(false);
            // The browser returns focus to the opener on close; this covers the case where it landed on <body>.
            requestAnimationFrame(() => {
              if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
            });
          }}
        />
      )}
    </SidebarMenuItem>
  );
}
