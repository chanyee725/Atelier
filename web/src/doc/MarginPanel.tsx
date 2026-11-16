// Agent activity margin of the document view (E532, issue #622): one card per agent session editing the open
// document — who it is (session name, role colour, model, provider mark), its state, what it is doing right now in
// plain words, and its recent changes as a time-ordered list. A change jumps to its block in the document and
// flashes it (and the agent's cursor, doc/DocAgentCursors.tsx) in the agent's colour.
//
// Presentational: the cards come from the margin store (doc/marginStore.ts, model in doc/agentMargin.ts) and the
// layout (side panel or bottom sheet, collapsed or not) from the document pane. It never takes focus from the editor:
// its buttons keep focus where it is on mouse down, and the panel only reacts to what the user clicks.
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, PanelRightClose } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { roleLabel } from '../run/overlayModel';
import { now, reducedMotion } from '../canvas/cursorStore';
import { ago, PHASE_LABEL, type MarginForm, type MarginPhase } from './agentMargin';
import type { DocSpot } from './docCursor';
import './margin-panel.css';

/** One recent change of a card, newest first. `at` is on the `now()` clock (canvas/cursorStore.ts). */
export type MarginChange = { id: string; label: string; at: number; spot: DocSpot };

/** One agent card as the panel shows it (built by the store from MarginAgent, marginPhase and doingLines). */
export type MarginCard = {
  sid: string;
  name: string;
  role: string;
  /** `#rrggbb`, or '' (the role colour). */
  color: string;
  model?: string | null;
  /** Provider id (claude, openai, gemini) for its mark. */
  provider?: string | null;
  phase: MarginPhase;
  /** What it is doing right now, in plain words. */
  main: string;
  /** The step it works on, or what it just changed. */
  sub: string | null;
  changes: readonly MarginChange[];
};

type Props = {
  agents: readonly MarginCard[];
  form: MarginForm;
  collapsed: boolean;
  onToggle: () => void;
  /** Jump to a change; default: scroll the document's block into view and flash it. */
  onJump?: (spot: DocSpot, card: MarginCard) => void;
};

/** How long a jumped-to block (and its agent's cursor) stays highlighted. */
const FLASH_MS = 1600;

/** Keep focus in the editor: a click on the panel never moves it (keyboard use still can). */
const keepFocus = (e: MouseEvent) => e.preventDefault();

const agentStyle = (c: MarginCard): CSSProperties => ({ '--agent': c.color || `var(--role-${c.role}, var(--idle))` }) as CSSProperties;

/** The document's top-level block elements, in order (ProseMirror widgets and gap cursors are not blocks). */
function blockAt(from: Element, index: number): HTMLElement | null {
  const host = from.closest('[data-doc-view], .doc-host') ?? document;
  const editor = host.querySelector('.ProseMirror');
  if (!editor) return null;
  const blocks = [...editor.children].filter((el) => !el.matches('.ProseMirror-widget, .ProseMirror-gapcursor, .ProseMirror-trailingBreak'));
  if (!blocks.length) return null;
  return blocks[Math.min(index, blocks.length - 1)] as HTMLElement;
}

let jumpSeq = 0;

/** Scroll to the change's block, then flash it and the agent's cursor (only the latest jump flashes). */
async function jumpTo(from: Element, spot: DocSpot, card: MarginCard) {
  const el = blockAt(from, spot.index);
  if (!el) return;
  const seq = ++jumpSeq;
  // A Promise where scroll method promises are supported; elsewhere the flash starts with the scroll.
  await el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  if (seq !== jumpSeq) return;
  const marks: HTMLElement[] = [el];
  const cursor = document.querySelector<HTMLElement>(`[data-doc-agent-cursor="${CSS.escape(card.sid)}"]`);
  if (cursor) marks.push(cursor);
  el.style.setProperty('--margin-flash', card.color || `var(--role-${card.role}, var(--idle))`);
  for (const m of marks) {
    m.removeAttribute('data-margin-flash');
    void m.offsetWidth; // restart the animation on a second click
    m.setAttribute('data-margin-flash', '');
  }
  setTimeout(() => {
    for (const m of marks) m.removeAttribute('data-margin-flash');
    el.style.removeProperty('--margin-flash');
  }, FLASH_MS);
}

/** Re-render every few seconds for the "12초 전" labels, only while something shows them. */
function useClock(on: boolean): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    if (!on) return;
    setT(now());
    const id = setInterval(() => setT(now()), 5000);
    return () => clearInterval(id);
  }, [on]);
  return t;
}

function Dots() {
  return (
    <span className="margin-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function Card({ card, t, onJump }: { card: MarginCard; t: number; onJump: (e: MouseEvent<HTMLButtonElement>, spot: DocSpot, card: MarginCard) => void }) {
  const name = card.name || roleLabel(card.role);
  return (
    <li className="margin-card" data-margin-card={card.sid} data-phase={card.phase} style={agentStyle(card)}>
      <div className="margin-who">
        <span className="margin-swatch" aria-hidden="true" />
        <span className="margin-name">{name}</span>
        <span className="margin-phase" data-margin-phase={card.phase}>
          {card.phase !== 'waiting' && <Dots />}
          {PHASE_LABEL[card.phase]}
        </span>
      </div>
      {(card.model || card.provider || card.name) && (
        <div className="margin-meta">
          {card.name && card.role && <span>{roleLabel(card.role)}</span>}
          {(card.model || card.provider) && (
            <span className="margin-model">
              <ProviderIcon provider={card.provider} />
              {card.model}
            </span>
          )}
        </div>
      )}
      <p className="margin-doing" data-margin-doing="">
        {card.main}
      </p>
      {card.sub && <p className="margin-sub">{card.sub}</p>}
      {card.changes.length > 0 && (
        <ol className="margin-changes" aria-label={`${name}의 최근 변경`}>
          {card.changes.map((c) => (
            <li key={c.id}>
              <button type="button" className="margin-change" data-margin-change={c.id} onMouseDown={keepFocus} onClick={(e) => onJump(e, c.spot, card)}>
                <span className="margin-change-label">{c.label}</span>
                <time className="margin-change-ago">{ago(t - c.at)}</time>
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function MarginPanel({ agents, form, collapsed, onToggle, onJump }: Props) {
  const listId = useId();
  const root = useRef<HTMLElement>(null);
  const shown = agents.length > 0;
  const t = useClock(shown && !collapsed);
  const count = agents.length;
  const title = count > 1 ? `에이전트 ${count}명이 작업 중이에요` : '에이전트가 작업 중이에요';
  const jump = (e: MouseEvent<HTMLButtonElement>, spot: DocSpot, card: MarginCard) => {
    if (onJump) onJump(spot, card);
    else void jumpTo(e.currentTarget, spot, card);
  };

  // Collapsed side panel: a slim rail with one swatch per agent; the whole rail opens it.
  if (form === 'side' && collapsed) {
    return (
      <aside ref={root} className="margin-panel" data-margin-panel="" data-form={form} data-collapsed="" hidden={!shown} aria-label="에이전트 작업">
        <button type="button" className="margin-rail" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={false} aria-controls={listId} title="에이전트 작업 펼치기">
          <ChevronRight className="margin-rail-chevron" aria-hidden="true" />
          {agents.map((c) => (
            <span key={c.sid} className="margin-rail-dot" data-phase={c.phase} style={agentStyle(c)} aria-hidden="true" />
          ))}
          <span className="sr-only">{title}, 펼치기</span>
        </button>
      </aside>
    );
  }

  const ToggleIcon = form === 'side' ? PanelRightClose : collapsed ? ChevronUp : ChevronDown;
  return (
    <aside ref={root} className="margin-panel" data-margin-panel="" data-form={form} data-collapsed={collapsed ? '' : undefined} hidden={!shown} aria-label="에이전트 작업">
      <header className="margin-head">
        {form === 'sheet' && collapsed ? (
          <button type="button" className="margin-sheet-bar" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={false} aria-controls={listId}>
            <span className="margin-sheet-dots" aria-hidden="true">
              {agents.map((c) => (
                <span key={c.sid} className="margin-rail-dot" data-phase={c.phase} style={agentStyle(c)} />
              ))}
            </span>
            <span className="margin-title">{title}</span>
            <span className="margin-sheet-doing">{agents[0]?.main}</span>
            <ChevronUp className="margin-toggle-icon" aria-hidden="true" />
          </button>
        ) : (
          <>
            <h2 className="margin-title" aria-live="polite">
              {title}
            </h2>
            <button type="button" className="margin-toggle" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={true} aria-controls={listId} title="접기" aria-label="에이전트 작업 접기">
              <ToggleIcon aria-hidden="true" />
            </button>
          </>
        )}
      </header>
      <ul id={listId} className="margin-cards" hidden={collapsed}>
        {agents.map((c) => (
          <Card key={c.sid} card={c} t={t} onJump={jump} />
        ))}
      </ul>
    </aside>
  );
}
