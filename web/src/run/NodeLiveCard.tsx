// In-progress node → the model doing it (#736). An HTML button over a node's agent badges: hover or focus shows a
// card per agent (name, model with provider icon, state, current tool and target, elapsed time; AgentLiveSummary),
// click or Enter opens that agent's live view panel in the Drawing shell (web/src/live/store.ts), never the standalone
// Dispatch UI. Several agents: the card lists them and a row click picks one. Esc closes the card (Radix Popover).
// The node body stays click-through so canvas editing under the overlay is not blocked.
import { useEffect, useRef, useState } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { PopoverContent } from '../components/ui/popover';
import { AgentLiveSummary } from '../live/AgentLiveSummary';
import { openAgentLive, useAgentLiveTarget } from '../live/store';
import { pressAction, type LiveTarget } from './overlayModel';

/** Hover delays (ms): open a little late so passing the mouse over does not flash cards, close late enough to reach it. */
const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;

type Box = { left: number; top: number; width: number; height: number };

export function NodeLiveCard({ open: targets, title, time, box }: { open: readonly LiveTarget[]; title: string; time?: string; box: Box }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = useAgentLiveTarget();
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (v: boolean) => {
    clear();
    timer.current = setTimeout(() => setShown(v), v ? OPEN_DELAY : CLOSE_DELAY);
  };
  useEffect(() => clear, []);

  const go = (sid: string) => {
    clear();
    setShown(false);
    openAgentLive(sid, { from: 'node', trigger: trigger.current });
  };
  const press = () => {
    const a = pressAction(targets);
    if (!a) return;
    if (a.kind === 'open') return go(a.sid);
    clear();
    setShown(true);
    // Keyboard and click users land on the first row; the card may already be open from hover or focus.
    requestAnimationFrame(() => list.current?.querySelector('button')?.focus());
  };
  const names = targets.map((t) => t.name).join(', ');
  const isOpen = targets.some((t) => t.sid === current);

  return (
    <PopoverPrimitive.Root open={shown} onOpenChange={(v) => (clear(), setShown(v))}>
      <PopoverPrimitive.Anchor asChild>
        <button
          ref={trigger}
          type="button"
          className="run-node-live"
          data-node-live=""
          style={box}
          aria-label={`${title}: ${names} 진행 보기`}
          aria-haspopup={targets.length > 1 ? 'dialog' : undefined}
          aria-expanded={targets.length > 1 ? shown : isOpen}
          onPointerEnter={(e) => e.pointerType === 'mouse' && later(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && later(false)}
          onFocus={() => later(true)}
          onBlur={(e) => {
            // Focus moving into the card keeps it open.
            const next = e.relatedTarget as Node | null;
            if (!next || !list.current?.closest('[data-node-live-card]')?.contains(next)) later(false);
          }}
          onClick={press}
        />
      </PopoverPrimitive.Anchor>
      <PopoverContent
        side="top"
        className="w-72 border border-border p-2"
        data-node-live-card=""
        aria-label={`${title} 진행 중인 에이전트`}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={(e) => e.pointerType === 'mouse' && clear()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && later(false)}
        onFocusOutside={(e) => {
          if (e.target === trigger.current) e.preventDefault();
        }}
        onEscapeKeyDown={() => trigger.current?.focus({ preventScroll: true })}
      >
        <p className="m-0 mb-1.5 flex items-baseline gap-1.5 px-1 text-xs text-muted-foreground">
          <span className="truncate font-medium text-foreground">{title}</span>
          {time && <span className="ml-auto shrink-0 tabular-nums">{time}</span>}
        </p>
        <ul ref={list} className="m-0 grid list-none gap-1 p-0">
          {targets.map((t) => (
            // The summary holds a heading, so it cannot sit inside a button: the row is clickable for the mouse and
            // its own button is the keyboard path.
            <li key={t.sid} className="flex cursor-pointer items-start gap-1 rounded-md px-1.5 py-1 hover:bg-accent" onClick={() => go(t.sid)}>
              <div className="min-w-0 flex-1">
                <AgentLiveSummary sid={t.sid} name={t.name} />
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`${t.name} 진행 보기`}
                onClick={(e) => (e.stopPropagation(), go(t.sid))}
              >
                열기
              </button>
            </li>
          ))}
        </ul>
              </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
