// Agent activity margin of the document view (E532, issue #622): one card per agent session editing the open
// document — who it is (session name, role colour, model, provider mark), a status line ("다이어그램 작성 중…", E537),
// what it works on now in plain words, and its recent steps as a timeline. Two cards a row when the panel is wide
// (a container query, margin-panel.css). A change jumps to its block in the document and
// flashes it (and the agent's cursor, doc/DocAgentCursors.tsx) in the agent's colour.
//
// Presentational: the cards come from the margin store (doc/marginStore.ts, model in doc/agentMargin.ts) and the
// layout (side panel or bottom sheet, collapsed or not) from the document pane, which also owns the container
// (`.doc-margin-aside`: placement, entry and exit). It never takes focus from the editor: its buttons keep focus where
// it is on mouse down, and the panel only reacts to what the user clicks.
import { useId, type CSSProperties, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, PanelRightClose } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { roleLabel } from '../run/overlayModel';
import type { MarginForm } from './agentMargin';
import type { DocSpot } from './docCursor';
import type { MarginCard } from './marginStore';
import './margin-panel.css';

export type { MarginCard };

type Props = {
  agents: readonly MarginCard[];
  form: MarginForm;
  collapsed: boolean;
  onToggle: () => void;
  /** A recent change was clicked: scroll to its block and flash it (marginStore.jumpTo). */
  onJump?: (spot: DocSpot) => void;
};

/** How long the agent's cursor is outlined after a jump (the block's own flash is .doc-margin-flash). */
const FLASH_MS = 1600;

/** Keep focus in the editor: a click on the panel never moves it (keyboard use still can). */
const keepFocus = (e: MouseEvent) => e.preventDefault();

const agentStyle = (c: MarginCard): CSSProperties => ({ '--agent': c.color || `var(--role-${c.role}, var(--idle))` }) as CSSProperties;

/** The pending end of each cursor's outline, so a second click restarts it instead of being cut short by the first. */
const flashEnds = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Outline the agent's document cursor briefly, so the jumped-to spot shows whose change it was. */
function flashCursor(sid: string) {
  const el = document.querySelector<HTMLElement>(`[data-doc-agent-cursor="${CSS.escape(sid)}"]`);
  if (!el) return;
  clearTimeout(flashEnds.get(el));
  el.removeAttribute('data-margin-flash');
  void el.offsetWidth; // restart on a second click
  el.setAttribute('data-margin-flash', '');
  flashEnds.set(
    el,
    setTimeout(() => {
      flashEnds.delete(el);
      el.removeAttribute('data-margin-flash');
    }, FLASH_MS),
  );
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

function Card({ card, onJump }: { card: MarginCard; onJump: (spot: DocSpot, card: MarginCard) => void }) {
  const name = card.name || card.roleName || roleLabel(card.role);
  const stepsId = useId();
  return (
    <li className="margin-card" data-margin-card={card.sid} data-phase={card.phase} style={agentStyle(card)}>
      <div className="margin-who">
        <span className="margin-swatch" aria-hidden="true" />
        <span className="margin-name">{name}</span>
        {(card.model || card.provider) && (
          <span className="margin-model">
            <ProviderIcon provider={card.provider} />
            {card.model}
          </span>
        )}
      </div>
      {card.name && card.role && <div className="margin-meta">{card.roleName || roleLabel(card.role)}</div>}
      <p className="margin-status" data-margin-status="" data-margin-phase={card.phase}>
        {card.phase !== 'waiting' && <Dots />}
        <span>{card.status}</span>
      </p>
      <div className="margin-now">
        <span className="margin-label">지금</span>
        <p className="margin-doing" data-margin-doing="">
          {card.doing}
        </p>
        {card.sub && <p className="margin-sub">{card.sub}</p>}
      </div>
      {card.changes.length > 0 && (
        <div className="margin-steps">
          <span className="margin-label" id={stepsId}>
            최근 단계
          </span>
          <ol className="margin-changes" aria-labelledby={stepsId}>
            {card.changes.map((c) => (
              <li key={c.id}>
                <button type="button" className="margin-change" data-margin-change={c.id} onMouseDown={keepFocus} onClick={() => onJump(c.spot, card)} title="이 위치로 이동">
                  <span className="margin-change-label">{c.label}</span>
                  <span className="margin-change-ago">{c.ago}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

export function MarginPanel({ agents, form, collapsed, onToggle, onJump }: Props) {
  const listId = useId();
  const count = agents.length;
  const title = count > 1 ? `에이전트 ${count}명이 작업 중이에요` : '에이전트가 작업 중이에요';
  const jump = (spot: DocSpot, card: MarginCard) => {
    onJump?.(spot);
    flashCursor(card.sid);
  };

  // Collapsed side panel: a slim rail with one swatch per agent; the whole rail opens it. The card list is not
  // rendered here, so the rail has no aria-controls (it would point at nothing).
  if (form === 'side' && collapsed) {
    return (
      <div className="margin-panel" data-margin-panel="" data-form={form} data-collapsed="">
        <button type="button" className="margin-rail" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={false} title="에이전트 작업 펼치기">
          <ChevronRight className="margin-rail-chevron" aria-hidden="true" />
          {agents.map((c) => (
            <span key={c.sid} className="margin-rail-dot" data-phase={c.phase} style={agentStyle(c)} aria-hidden="true" />
          ))}
          <span className="sr-only">{title}, 펼치기</span>
        </button>
      </div>
    );
  }

  const ToggleIcon = form === 'side' ? PanelRightClose : collapsed ? ChevronUp : ChevronDown;
  return (
    <div className="margin-panel" data-margin-panel="" data-form={form} data-collapsed={collapsed ? '' : undefined}>
      <header className="margin-head">
        {form === 'sheet' && collapsed ? (
          <button type="button" className="margin-sheet-bar" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={false} aria-controls={listId}>
            <span className="margin-sheet-dots" aria-hidden="true">
              {agents.map((c) => (
                <span key={c.sid} className="margin-rail-dot" data-phase={c.phase} style={agentStyle(c)} />
              ))}
            </span>
            <span className="margin-title">{title}</span>
            <span className="margin-sheet-doing">{agents[0]?.status}</span>
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
          <Card key={c.sid} card={c} onJump={jump} />
        ))}
      </ul>
    </div>
  );
}
