// Sidebar model rows (E525, #570), ported from Dispatch's Sidebar provider list: one row per entry in PROVIDERS
// (modelConnect.ts, keyed by provider id; only Claude for now, #587 adds more), each with a status dot and its text
// (설치 안 됨 / 로그인 중 / 5-hour usage / 연결 안 됨). A row opens the 설정 modal at 모델 연결
// (settings/sections/ProvidersSection.tsx), where connect, cancel and disconnect happen (#624).
// Hovering or focusing a row shows its usage limits (SidebarUsageCard, #698). State comes from GET /api/state and the
// `providers` SSE event (docs/design/model-connection-contract.md). Nothing here reads credentials or logs anything.
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, type DispatchStatus, type ProviderLimits, type ProviderState } from './api';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from './components/ui/sidebar';
import { events } from './lib/events';
import { cn } from './lib/utils';
import { PROVIDERS, rowStatus, type ProviderMeta, type RowTone } from './modelConnect';
import { ProviderIcon } from './ProviderIcon';
import { MODELS_CHANGED } from './settings/context';
import { SettingsModal, closeTo } from './settings/SettingsEntry';
import { pollLogins } from './settings/model';
import { createModelsStore } from './settings/modelsStore';
import { SidebarUsageCard, useUsageCard } from './SidebarUsageCard';

const DOT: Record<RowTone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-destructive', off: 'bg-muted-foreground' };

export type Models = {
  status: DispatchStatus | null;
  /** State per provider id, as the server reports it. */
  providers: Record<string, ProviderState>;
  limits: ProviderLimits;
  reload: () => Promise<void>;
};

// One shared subscription for every reader (#616): the first reader starts it, the last one stops it.
const store = createModelsStore({
  dispatch: api.dispatch,
  providers: api.providers,
  limits: api.limits,
  onProviders: (fn) => events.subscribeJson<Record<string, ProviderState>>('providers', fn),
  onLimits: (fn) => events.subscribe('limits', fn),
  onConnection: (fn) => events.onConnection(fn),
  onChanged: (fn) => {
    window.addEventListener(MODELS_CHANGED, fn);
    return () => window.removeEventListener(MODELS_CHANGED, fn);
  },
  every: (fn, ms) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
  // Fallback while a CLI login runs: check back every 2 s, give up after 10 minutes.
  pollLogins: (load) => pollLogins(load, () => {}),
});

/** Provider state and usage. Live through the `providers` event; reloads on reconnect, on MODELS_CHANGED and every minute. */
export function useModels(): Models {
  const snap = useSyncExternalStore(store.subscribe, store.get);
  return useMemo(() => ({ ...snap, reload: store.reload }), [snap]);
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
  // Usage card on hover and keyboard focus (#698); the click still opens 모델 연결.
  const card = useUsageCard();
  const cardId = `usage-card-${meta.id}`;
  return (
    <SidebarMenuItem {...card.hover}>
      <SidebarMenuButton
        ref={trigger}
        data-testid="model-row"
        data-provider={meta.id}
        data-state-key={s.key}
        aria-haspopup="dialog"
        aria-label={`${meta.name} ${s.text}, 연결 관리`}
        aria-describedby={card.open ? cardId : undefined}
        {...card.trigger}
        onClick={() => {
          card.close();
          setOpen(true);
        }}
        className="max-md:h-11"
      >
        {/* The provider's mark in the same 17px slot as the nav icons, so the name lines up with 홈, 최근, 보관함. */}
        <span aria-hidden className="grid size-[17px] shrink-0 place-items-center">
          <ProviderIcon provider={meta.id} className="size-4" />
        </span>
        <span className="truncate">{meta.name}</span>
        <span className={cn('ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums', s.tone === 'warn' || s.tone === 'bad' ? 'text-foreground' : 'text-muted-foreground')}>
          <i aria-hidden data-testid="model-row-dot" className={cn('size-1.5 shrink-0 rounded-full', DOT[s.tone])} />
          {s.text}
        </span>
      </SidebarMenuButton>
      {card.open && !open && <SidebarUsageCard id={meta.id} meta={meta} anchor={trigger} hover={card.hover} statusText={s.text} />}
      {open && <SettingsModal section="providers" onClose={closeTo(trigger, () => setOpen(false))} />}
    </SidebarMenuItem>
  );
}
