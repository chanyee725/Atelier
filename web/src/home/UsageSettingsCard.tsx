// 사용량 설정 card of the dashboard (#793). The sidebar's model rows already show each provider's 5-hour usage, so this
// card is about the limits instead: one row per frontier provider (Claude, Codex, Gemini) with its mark, how full each
// window is against the limit that stops new work (a tick on the bar), and a click that opens 설정 › 사용 한도 at that
// provider's fields. Numbers only: usage comes from the shared models store, limits from GET /api/state's settings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { api, type DispatchSettings } from '../api';
import { cn } from '../lib/utils';
import { PROVIDERS, providerUsage, rowStatus, windowlessText, type ProviderMeta } from '../modelConnect';
import { until } from '../dispatch/lib/format.ts';
import { percent } from '../projectNav';
import { ProviderIcon } from '../ProviderIcon';
import { SettingsModal } from '../settings/SettingsEntry';
import { guardValue, type GuardField } from '../settings/model';
import { useModels, type Models } from '../SidebarModels';
import { Card } from './dash';

/** The guard field that limits a provider's window, by the window's label. */
const LIMIT_OF: Record<string, Partial<Record<string, GuardField['id']>>> = {
  claude: { '5시간': 'five', 주간: 'seven' },
  openai: { '5시간': 'codexFive', 주간: 'codexSeven' },
};

/** Opens 설정 › 사용 한도 and brings the provider's fieldset into view with its first field focused. */
function focusProvider(id: string) {
  let tries = 0;
  const step = () => {
    const set = document.querySelector<HTMLFieldSetElement>(`[data-testid="limits-form"] fieldset[data-provider="${id}"]`);
    if (set && set.offsetParent !== null) {
      set.scrollIntoView({ block: 'center' });
      set.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      return;
    }
    if (++tries < 60) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function UsageSettingsCard() {
  const models = useModels();
  const [settings, setSettings] = useState<DispatchSettings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(() => {
    api.dispatchState().then(
      (s) => setSettings(s.settings ?? null),
      () => setSettings(null),
    );
  }, []);
  useEffect(load, [load]);
  return (
    <Card id="usage-settings" title="사용량 설정" hint="모델을 누르면 멈추는 한도를 바꿀 수 있어요" flush>
      <ul aria-label="모델별 사용 한도" className="m-0 list-none divide-y p-0">
        {PROVIDERS.map((meta) => (
          <ProviderLimitRow
            key={meta.id}
            meta={meta}
            models={models}
            settings={settings}
            onOpen={(el) => {
              trigger.current = el;
              setOpen(meta.id);
              focusProvider(meta.id);
            }}
          />
        ))}
      </ul>
      {open &&
        createPortal(
          <SettingsModal
            section="limits"
            onClose={() => {
              setOpen(null);
              load();
              requestAnimationFrame(() => {
                if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
              });
            }}
          />,
          document.body,
        )}
    </Card>
  );
}

function ProviderLimitRow({ meta, models, settings, onOpen }: { meta: ProviderMeta; models: Models; settings: DispatchSettings | null; onOpen: (el: HTMLButtonElement) => void }) {
  const status = rowStatus(meta, models.providers[meta.id], !!models.status?.enabled, models.limits);
  const connected = status.key === 'connected';
  const usage = providerUsage(meta, models.limits);
  const limits = LIMIT_OF[meta.id];
  // Gemini has no block thresholds: its /usage windows (#878) show as bars without a tick.
  const windows = limits ? usage.windows.filter((w) => limits[w.label]) : meta.windowless ? usage.windows : [];
  return (
    <li data-provider={meta.id}>
      <button
        type="button"
        onClick={(e) => onOpen(e.currentTarget)}
        aria-label={`${meta.name} 사용 한도 바꾸기`}
        className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 text-left hover:bg-accent/40 focus-visible:bg-accent focus-visible:outline-none"
      >
        <span aria-hidden className={cn('grid size-8 place-items-center rounded-md border bg-background', !connected && 'opacity-50')}>
          <ProviderIcon provider={meta.id} className="size-[18px]" />
        </span>
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13px] font-medium">{meta.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{connected ? '연결됨' : status.text}</span>
          </span>
          {windows.length > 0 ? (
            windows.map((w) => {
              const id = limits?.[w.label];
              if (!id) return <LimitBar key={w.label} label={w.label} used={percent(w.used)} limit={null} unguarded />;
              const limit = settings ? guardValue(id, settings) : null;
              return <LimitBar key={w.label} label={w.label} used={percent(w.used)} limit={limit} />;
            })
          ) : meta.windowless ? (
            <span data-windowless className={cn('text-xs', usage.reached ? 'text-foreground' : 'text-muted-foreground')}>{windowlessText(connected, usage.reached, usage.reset, (t) => until(t))}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{connected ? '아직 사용량 정보가 없어요' : '연결하면 한도를 볼 수 있어요'}</span>
          )}
        </span>
        <ChevronRight aria-hidden className="mt-2 size-4 text-muted-foreground" />
      </button>
    </li>
  );
}

/** One window: how full it is, a tick where new work stops, and both numbers. Over the limit turns the fill warm. */
function LimitBar({ label, used, limit, unguarded = false }: { label: string; used: number | null; limit: number | null; unguarded?: boolean }) {
  const u = Math.min(100, Math.max(0, used ?? 0));
  const over = used != null && limit != null && used >= limit;
  return (
    <span className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="relative h-1.5 rounded-full bg-muted" role="img" aria-label={unguarded ? `${label} ${used ?? 0}% 사용` : `${label} ${used ?? 0}% 사용, ${limit ?? '-'}%에서 멈춤`}>
        <span className={cn('absolute inset-y-0 left-0 rounded-full', over ? 'bg-warn' : 'bg-ok')} style={{ width: `${u}%` }} />
        {limit != null && <span aria-hidden className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground/70" style={{ left: `calc(${limit}% - 1px)` }} />}
      </span>
      <span className="tabular-nums whitespace-nowrap">
        <span className={over ? 'font-medium text-foreground' : undefined}>{used ?? 0}%</span>
        {!unguarded && <span className="text-muted-foreground"> / {limit ?? '–'}%</span>}
      </span>
    </span>
  );
}
