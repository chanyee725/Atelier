// Agent activity margin of the document view (E532, issue #622): one card per agent session editing the open
// document — who it is (session name, role colour, model, provider mark), its state, what it is doing right now in
// plain words, and its recent changes as a time-ordered list. A change jumps to its block in the document and
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

/** Outline the agent's document cursor briefly, so the jumped-to spot shows whose change it was. */
function flashCursor(sid: string) {
  const el = document.querySelector<HTMLElement>(`[data-doc-agent-cursor="${CSS.escape(sid)}"]`);
  if (!el) return;
  el.removeAttribute('data-margin-flash');
  void el.offsetWidth; // restart on a second click
  el.setAttribute('data-margin-flash', '');
  setTimeout(() => el.removeAttribute('data-margin-flash'), FLASH_MS);
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
  return (
    <li className="margin-card" data-margin-card={card.sid} data-phase={card.phase} style={agentStyle(card)}>
      <div className="margin-who">
        <span className="margin-swatch" aria-hidden="true" />
        <span className="margin-name">{name}</span>
        <span className="margin-phase" data-margin-phase={card.phase}>
          {card.phase !== 'waiting' && <Dots />}
          {card.phaseLabel}
        </span>
      </div>
      {(card.model || card.provider || card.name) && (
        <div className="margin-meta">
          {card.name && card.role && <span>{card.roleName || roleLabel(card.role)}</span>}
          {(card.model || card.provider) && (
            <span className="margin-model">
              <ProviderIcon provider={card.provider} />
              {card.model}
            </span>
          )}
        </div>
      )}
      <p className="margin-doing" data-margin-doing="">
        {card.doing}
      </p>
      {card.sub && <p className="margin-sub">{card.sub}</p>}
      {card.changes.length > 0 && (
        <ol className="margin-changes" aria-label={`${name}의 최근 변경`}>
          {card.changes.map((c) => (
            <li key={c.id}>
              <button type="button" className="margin-change" data-margin-change={c.id} onMouseDown={keepFocus} onClick={() => onJump(c.spot, card)}>
                <span className="margin-change-label">{c.label}</span>
                <span className="margin-change-ago">{c.ago}</span>
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
  const count = agents.length;
  const title = count > 1 ? `에이전트 ${count}명이 작업 중이에요` : '에이전트가 작업 중이에요';
  const jump = (spot: DocSpot, card: MarginCard) => {
    onJump?.(spot);
    flashCursor(card.sid);
  };

  // Collapsed side panel: a slim rail with one swatch per agent; the whole rail opens it.
  if (form === 'side' && collapsed) {
    return (
      <div className="margin-panel" data-margin-panel="" data-form={form} data-collapsed="">
        <button type="button" className="margin-rail" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={false} aria-controls={listId} title="에이전트 작업 펼치기">
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
            <span className="margin-sheet-doing">{agents[0]?.doing}</span>
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
