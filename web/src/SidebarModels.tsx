// Sidebar model rows (design doc 6 §2.1, issues E51, E509): one row, Claude · Fable 5.2 with its 5-hour usage, a
// status dot and its text, aligned with the nav rows. This row is where the model is connected and disconnected:
// 연결하기 (hover/focus), 연결 중 with 취소 while a login runs, and a ⋯ menu with 연결 끊기 and 다시 확인.
// It sends the same provider requests the old settings dialog did, which run the user's own CLI login.
// Nothing here reads credentials or logs anything.
import { MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type DispatchStatus, type ProviderLimits, type ProviderState } from './api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuItem } from './components/ui/sidebar';
import { useMenuState } from './lib/menuEscape';
import { cn } from './lib/utils';
import { MODELS_CHANGED } from './settings/context';
import { LOGIN_ENDED_NOTE, LOGIN_POLL_TIMEOUT_NOTE, loginUnlessClosed, oneAtATime, pollLogins, type ProviderId } from './settings/model';
import { fiveHourWindow, limitReached, modelStatus, percent, type ModelLine, type ModelTone } from './projectNav';

const PROVIDERS = [['claude', 'Claude · Fable 5.2']] as const;

const DOT: Record<ModelTone, string> = { ok: 'bg-ok', warn: 'bg-warn', off: 'bg-muted-foreground' };

// Small buttons at the right end of the row. Not nested in anything clickable: each is its own tab stop.
const ACTION = 'absolute top-[3px] right-1 h-6 rounded-md bg-sidebar px-2 text-xs font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring max-md:top-0 max-md:h-11 max-md:px-3';
// Revealed on hover and keyboard focus-within where a pointer can hover; always shown on touch.
const REVEAL = 'md:pointer-fine:opacity-0 md:pointer-fine:group-hover/menu-item:opacity-100 md:pointer-fine:group-focus-within/menu-item:opacity-100 md:pointer-fine:data-[state=open]:opacity-100';

/** Connection and 5-hour usage per provider. Polls slowly (every 2 s while a login runs). */
function useModels() {
  const [status, setStatus] = useState<DispatchStatus | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderState>>({});
  const [limits, setLimits] = useState<ProviderLimits>({});
  // A login that ended without connecting and without an error of its own: say so instead of waiting forever.
  const [note, setNote] = useState<string | null>(null);
  const wasBusy = useRef(false);
  const reload = useCallback(async () => {
    try {
      const s = await api.dispatch();
      setStatus(s);
      if (!s.enabled) return;
      const [pv, lim] = await Promise.all([api.providers(), api.limits().catch(() => ({}))]);
      const c = pv.claude;
      if (wasBusy.current && !c?.busy && !c?.connected && !c?.error) setNote(LOGIN_ENDED_NOTE);
      else if (c?.connected || c?.busy) setNote(null);
      wasBusy.current = !!c?.busy;
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
  // While a CLI login runs, check back every 2 s until it ends; give up after 10 minutes.
  const busy = Object.values(providers).some((p) => p?.busy);
  useEffect(() => {
    if (!busy) return;
    return pollLogins(() => void reload(), () => setNote(LOGIN_POLL_TIMEOUT_NOTE));
  }, [busy, reload]);
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
      busy: !!pv?.busy,
      url: typeof pv?.url === 'string' && pv.url.startsWith('https://') ? pv.url : null,
      error: pv?.error ?? null,
    };
  });
  return { status, lines, note, setNote, reload };
}

export function SidebarModels() {
  const { status, lines, note, setNote } = useModels();
  const [error, setError] = useState<string | null>(null);
  // One request at a time: a double click before the buttons change is dropped.
  const act = useMemo(
    () =>
      oneAtATime(async (what: 'connect' | 'cancel' | 'disconnect' | 'recheck', id: ProviderId) => {
        setError(null);
        setNote(null);
        try {
          if (what === 'connect') await loginUnlessClosed(id, api.providerLogin, api.providerCancel, () => false);
          else if (what === 'cancel') await api.providerCancel(id);
          else if (what === 'disconnect') await api.providerLogout(id);
          else await api.providerRefresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : '요청이 실패했어요.');
        } finally {
          window.dispatchEvent(new Event(MODELS_CHANGED));
        }
      }),
    [setNote],
  );
  // The row swaps its action button (연결하기 / 취소 / ⋯ menu). If the one the user just used unmounts and focus falls to
  // <body>, move it to the button that replaced it. Only after an action from this row, and only for a short while.
  const listRef = useRef<HTMLUListElement>(null);
  const acted = useRef(false);
  const run = (what: 'connect' | 'cancel' | 'disconnect' | 'recheck', id: ProviderId) => {
    acted.current = true;
    setTimeout(() => (acted.current = false), 15_000);
    void act(what, id);
  };
  const actionKey = lines.map((m) => (m.busy ? 'cancel' : m.connected ? 'menu' : 'connect')).join();
  useEffect(() => {
    if (!acted.current) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    const next = listRef.current?.querySelector<HTMLElement>('[data-testid="model-cancel"], [data-testid="model-connect"], [data-testid="model-menu"]');
    if (next) {
      next.focus();
      acted.current = false;
    }
  }, [actionKey, status]);
  if (!status) return null;
  const on = status.enabled;
  return (
    <SidebarMenu ref={listRef} aria-label="모델 연결">
      {lines.map((m) => {
        const s = modelStatus(m, on);
        const id = m.id as ProviderId;
        const missing = m.installed === false;
        const line = error ?? m.error ?? note ?? (missing && !m.connected ? 'CLI가 설치되지 않았어요.' : null);
        return (
          <SidebarMenuItem key={m.id}>
            <div
              title={`${m.name}: ${s.long}`}
              className={cn(
                'flex h-[30px] w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-sm font-medium text-sidebar-foreground/80 max-md:h-11',
                m.connected && 'pr-9',
                on && !m.connected && !m.busy && !missing && 'pr-20',
                m.busy && 'pr-16',
              )}
            >
              {/* Same 17px slot as the nav icons, so names line up with 모든 파일, 최근, 보관함. */}
              <span aria-hidden className="grid size-[17px] shrink-0 place-items-center">
                <i className={cn('size-2 rounded-full', DOT[s.tone])} />
              </span>
              <span className="truncate">{m.name}</span>
              <span className={cn('ml-auto shrink-0 text-xs tabular-nums', s.tone === 'warn' ? 'text-foreground' : 'text-muted-foreground')}>{s.text}</span>
            </div>
            {on && m.busy && (
              <button type="button" data-testid="model-cancel" aria-label={`${m.name} 연결 취소`} onClick={() => run('cancel', id)} className={ACTION}>
                취소
              </button>
            )}
            {on && !m.busy && !m.connected && !missing && (
              <button type="button" data-testid="model-connect" aria-label={`${m.name} 연결하기`} onClick={() => run('connect', id)} className={cn(ACTION, REVEAL)}>
                연결하기
              </button>
            )}
            {on && !m.busy && m.connected && (
              <ModelMenu name={m.name} onDisconnect={() => run('disconnect', id)} onRecheck={() => run('recheck', id)} />
            )}
            {m.busy && m.url && (
              <a href={m.url} target="_blank" rel="noreferrer noopener" className="block px-2 pb-1 text-xs underline">
                로그인 페이지 열기
              </a>
            )}
            {/* Always rendered, so its text changes are announced. */}
            <p role="status" className={cn('px-2 text-xs text-destructive', line && 'pb-1')}>
              {line}
            </p>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/** The ⋯ menu of a connected row: 연결 끊기 (the only way to disconnect) and 다시 확인. */
function ModelMenu({ name, onDisconnect, onRecheck }: { name: string; onDisconnect: () => void; onRecheck: () => void }) {
  const menu = useMenuState();
  return (
    <DropdownMenu {...menu}>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid="model-menu" aria-label={`${name} 메뉴`} className={cn(ACTION, 'grid w-6 place-items-center px-0 max-md:w-11', REVEAL)}>
          <MoreHorizontal aria-hidden className="size-[15px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        <DropdownMenuItem className="max-md:min-h-11" onSelect={onDisconnect}>
          연결 끊기
        </DropdownMenuItem>
        <DropdownMenuItem className="max-md:min-h-11" onSelect={onRecheck}>
          다시 확인
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
