// Sidebar model rows (design doc 6 §2.1, issue E51): one row, Claude · Fable 5.2 with its 5-hour usage with a
// status dot and its text, aligned with the nav rows. A row opens the settings dialog on 모델 연결 (E57), the one
// place that connects and disconnects models. Nothing here reads credentials or logs anything.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type DispatchStatus, type ProviderLimits, type ProviderState } from './api';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from './components/ui/sidebar';
import { cn } from './lib/utils';
import { MODELS_CHANGED, useOpenSettings } from './settings/context';
import { loginUnlessClosed, oneAtATime, type ProviderId } from './settings/model';
import { fiveHourWindow, limitReached, modelStatus, percent, type ModelLine, type ModelTone } from './projectNav';

const PROVIDERS = [['claude', 'Claude · Fable 5.2']] as const;

const DOT: Record<ModelTone, string> = { ok: 'bg-ok', warn: 'bg-warn', off: 'bg-muted-foreground' };

/** Connection and 5-hour usage per provider. Polls slowly; reloads when the settings dialog closes. */
function useModels() {
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
    return () => {
      clearInterval(t);
      window.removeEventListener(MODELS_CHANGED, reload);
    };
  }, [reload]);
  const lines: ModelLine[] = PROVIDERS.map(([id, name]) => {
    const pv = providers[id];
    const connected = !!pv?.connected;
    return {
      id,
      name,
      installed: pv?.installed ?? null,
      connected,
      pct: connected ? percent(fiveHourWindow(limits)?.used) : null,
      reached: limitReached(connected, limits),
    };
  });
  return { status, lines };
}

export function SidebarModels() {
  const { status, lines } = useModels();
  const [error, setError] = useState<string | null>(null);
  // The same login request the settings dialog's 연결 button sends; one at a time. The settings 모델 연결 panel
  // (and its polling) shows progress, the row refreshes through MODELS_CHANGED.
  const connect = useMemo(
    () =>
      oneAtATime(async (id: ProviderId) => {
        setError(null);
        try {
          await loginUnlessClosed(id, api.providerLogin, api.providerCancel, () => false);
        } catch (e) {
          setError(e instanceof Error ? e.message : '연결하지 못했어요.');
        } finally {
          window.dispatchEvent(new Event(MODELS_CHANGED));
        }
      }),
    [],
  );
  const openSettings = useOpenSettings();
  const { setOpenMobile } = useSidebar();
  if (!status) return null;
  const on = status.enabled;
  return (
    <SidebarMenu aria-label="모델 연결">
        {lines.map((m) => {
          const s = modelStatus(m, on);
          return (
            <SidebarMenuItem key={m.id}>
              <SidebarMenuButton aria-label={`${m.name} ${s.long}, 연결 설정 열기`} title={`${m.name}: ${s.long}`} onClick={() => {
                  setOpenMobile(false);
                  openSettings('models');
                }}>
                {/* Same 17px slot as the nav icons, so names line up with 모든 파일, 최근, 보관함. */}
                <span aria-hidden className="grid size-[17px] shrink-0 place-items-center">
                  <i className={cn('size-2 rounded-full', DOT[s.tone])} />
                </span>
                <span className="truncate">{m.name}</span>
                <span className={cn('ml-auto shrink-0 text-xs tabular-nums', s.tone === 'warn' ? 'text-foreground' : 'text-muted-foreground')}>{s.text}</span>
              </SidebarMenuButton>
              {on && !m.connected && (
                // Revealed on hover and keyboard focus (and always on touch); it covers the status text, so
                // the row never grows. Not nested in the row button: two buttons, two tab stops.
                <button
                  type="button"
                  data-testid="model-connect"
                  onClick={() => void connect(m.id as ProviderId)}
                  className="absolute top-[3px] right-1 h-6 rounded-md bg-sidebar px-2 text-xs font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring max-md:top-0 max-md:h-11 max-md:px-3 md:pointer-fine:opacity-0 md:pointer-fine:group-hover/menu-item:opacity-100 md:pointer-fine:group-focus-within/menu-item:opacity-100"
                >
                  연결하기
                </button>
              )}
              {error && <p role="status" className="px-2 pb-1 text-xs text-destructive">{error}</p>}
            </SidebarMenuItem>
          );
        })}
    </SidebarMenu>
  );
}
