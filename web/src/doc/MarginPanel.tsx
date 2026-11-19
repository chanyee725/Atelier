// Agent activity margin of the document view (E532, issue #622; compact layout #727): one row per agent session
// editing the open document — its colour, name and status line ("다이어그램 작성 중…", E537) — grouped by role, at most
// ROWS_MAX rows with "+N명 더 보기" per role until the user expands the list (doc/marginGroups.ts). A row opens its
// details: model and provider, what it works on now in plain words, and its recent steps as a timeline (one agent
// alone shows them open). A change jumps to its block in the document and flashes it (and the agent's cursor,
// doc/DocAgentCursors.tsx) in the agent's colour.
//
// Presentational: the cards come from the margin store (doc/marginStore.ts, model in doc/agentMargin.ts) and the
// layout (side panel or bottom sheet, collapsed or not) from the document pane, which also owns the container
// (`.doc-margin-aside`: placement, entry and exit). It never takes focus from the editor: its buttons keep focus where
// it is on mouse down, and the panel only reacts to what the user clicks.
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, PanelRightClose } from 'lucide-react';
import { ProviderIcon } from '../ProviderIcon';
import { roleLabel } from '../run/overlayModel';
import { openAgentLive } from '../live/store';
import type { MarginForm } from './agentMargin';
import type { DocSpot } from './docCursor';
import type { MarginCard } from './marginStore';
import { capDots, layoutAgents } from './marginGroups';
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
type FlashEnds = Map<HTMLElement, ReturnType<typeof setTimeout>>;

/** Outline the agent's document cursor briefly, so the jumped-to spot shows whose change it was. */
function flashCursor(ends: FlashEnds, sid: string) {
  const el = document.querySelector<HTMLElement>(`[data-doc-agent-cursor="${CSS.escape(sid)}"]`);
  if (!el) return;
  clearTimeout(ends.get(el));
  el.removeAttribute('data-margin-flash');
  void el.offsetWidth; // restart on a second click
  el.setAttribute('data-margin-flash', '');
  ends.set(
    el,
    setTimeout(() => {
      ends.delete(el);
      el.removeAttribute('data-margin-flash');
    }, FLASH_MS),
  );
}

/** End every pending outline now (the panel is going away). */
function endFlashes(ends: FlashEnds) {
  for (const [el, t] of ends) {
    clearTimeout(t);
    el.removeAttribute('data-margin-flash');
  }
  ends.clear();
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

/** Agent dots for the collapsed rail and sheet bar: at most DOTS_MAX, then "+N". */
function AgentDots({ agents }: { agents: readonly MarginCard[] }) {
  const { shown, more } = capDots(agents);
  return (
    <>
      {shown.map((c) => (
        <span key={c.sid} className="margin-rail-dot" data-phase={c.phase} style={agentStyle(c)} aria-hidden="true" />
      ))}
      {more > 0 && (
        <span className="margin-dots-more" aria-hidden="true">
          +{more}
        </span>
      )}
    </>
  );
}

function Status({ card }: { card: MarginCard }) {
  return (
    <span className="margin-status" data-margin-status="" data-margin-phase={card.phase}>
      {card.phase !== 'waiting' && <Dots />}
      <span className="margin-status-text">{card.status}</span>
    </span>
  );
}

type RowProps = {
  card: MarginCard;
  /** Details shown. */
  open: boolean;
  /** Null when the details always show (one agent alone). */
  onOpen: (() => void) | null;
  /** Show the role under the name (no group heading says it). */
  showRole: boolean;
  onJump: (spot: DocSpot, card: MarginCard) => void;
};

function Row({ card, open, onOpen, showRole, onJump }: RowProps) {
  const name = card.name || card.roleName || roleLabel(card.role);
  const stepsId = useId();
  const detailId = useId();
  return (
    <li className="margin-card" data-margin-card={card.sid} data-phase={card.phase} data-open={open ? '' : undefined} style={agentStyle(card)}>
      <div className="margin-who">
        <span className="margin-swatch" data-phase={card.phase} aria-hidden="true" />
        {/* Opens the agent's live view (#728); focus stays where it was (the editor) and returns there on close. */}
        <button type="button" className="margin-name" data-margin-live={card.sid} onMouseDown={keepFocus} onClick={() => openAgentLive(card.sid, { from: 'doc' })} title={`${name} 진행상황 보기`}>
          {name}
        </button>
        {onOpen ? (
          <button type="button" className="margin-peek" onMouseDown={keepFocus} onClick={onOpen} aria-expanded={open} aria-controls={open ? detailId : undefined} title={open ? '접기' : '자세히 보기'}>
            <Status card={card} />
            <ChevronDown className="margin-peek-icon" aria-hidden="true" />
          </button>
        ) : (
          <Status card={card} />
        )}
      </div>
      {open && (
        <div className="margin-detail" id={detailId}>
          {(showRole || card.model || card.provider) && (
            <div className="margin-meta">
              {showRole && card.name && card.role && <span>{card.roleName || roleLabel(card.role)}</span>}
              {(card.model || card.provider) && (
                <span className="margin-model">
                  <ProviderIcon provider={card.provider} />
                  {card.model}
                </span>
              )}
            </div>
          )}
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
        </div>
      )}
    </li>
  );
}

export function MarginPanel({ agents, form, collapsed, onToggle, onJump }: Props) {
  const listId = useId();
  const count = agents.length;
  const title = count > 1 ? `에이전트 ${count}명이 작업 중이에요` : '에이전트가 작업 중이에요';
  const flashEnds = useRef<FlashEnds>(new Map());
  // All rows instead of ROWS_MAX, and the one agent whose details are open (memory only).
  const [expanded, setExpanded] = useState(false);
  const [openSid, setOpenSid] = useState<string | null>(null);
  useEffect(() => {
    const ends = flashEnds.current;
    return () => endFlashes(ends);
  }, []);
  const jump = (spot: DocSpot, card: MarginCard) => {
    onJump?.(spot);
    flashCursor(flashEnds.current, card.sid);
  };

  // Collapsed side panel: a slim rail with one swatch per agent; the whole rail opens it. The card list is not
  // rendered here, so the rail has no aria-controls (it would point at nothing).
  if (form === 'side' && collapsed) {
    return (
      <div className="margin-panel" data-margin-panel="" data-form={form} data-collapsed="">
        <button type="button" className="margin-rail" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={false} title="에이전트 작업 펼치기">
          <ChevronRight className="margin-rail-chevron" aria-hidden="true" />
          <AgentDots agents={agents} />
          <span className="sr-only">{title}, 펼치기</span>
        </button>
      </div>
    );
  }

  const single = count === 1;
  const layout = layoutAgents(agents, { expanded, keep: openSid });
  const ToggleIcon = form === 'side' ? PanelRightClose : collapsed ? ChevronUp : ChevronDown;
  return (
    <div className="margin-panel" data-margin-panel="" data-form={form} data-collapsed={collapsed ? '' : undefined}>
      <header className="margin-head">
        {form === 'sheet' && collapsed ? (
          <button type="button" className="margin-sheet-bar" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={false} aria-controls={listId}>
            <span className="margin-sheet-dots" aria-hidden="true">
              <AgentDots agents={agents} />
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
            {/* In the head, so it stays in view however far the long list scrolls. */}
            {!collapsed && expanded && layout.overflows && (
              <button type="button" className="margin-less" data-margin-less="" onMouseDown={keepFocus} onClick={() => setExpanded(false)} aria-controls={listId}>
                줄이기
              </button>
            )}
            <button type="button" className="margin-toggle" onMouseDown={keepFocus} onClick={onToggle} aria-expanded={true} aria-controls={listId} title="접기" aria-label="에이전트 작업 접기">
              <ToggleIcon aria-hidden="true" />
            </button>
          </>
        )}
      </header>
      <div id={listId} className="margin-cards" hidden={collapsed}>
        {layout.groups.map((g) => (
          <section key={g.role} className="margin-group" data-margin-group={g.role} aria-label={single ? undefined : `${g.label} ${g.all.length}명`}>
            {!single && (
              <h3 className="margin-group-head" aria-hidden="true">
                <span>{g.label}</span>
                <span className="margin-group-count">{g.all.length}</span>
              </h3>
            )}
            <ul className="margin-rows">
              {g.shown.map((c) => (
                <Row
                  key={c.sid}
                  card={c}
                  open={single || openSid === c.sid}
                  onOpen={single ? null : () => setOpenSid((s) => (s === c.sid ? null : c.sid))}
                  showRole={single}
                  onJump={jump}
                />
              ))}
            </ul>
            {g.hidden > 0 && (
              <button type="button" className="margin-more" data-margin-more={g.role} onMouseDown={keepFocus} onClick={() => setExpanded(true)}>
                +{g.hidden}명 더 보기
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
