// Chat dock (#937): a round button at the bottom right opens a 380×560 chat window, so a person can talk to a session
// from the web instead of the CLI. The default partner is the 도우미 (helper), a lead-level session of this project
// made on the first send; any other live session can be picked in the window's header.
// The window is a non-modal <dialog popover="manual">: the page stays usable, ✕ or Esc closes it and focus goes back
// to the button. It moves left of an open agent live panel and hides under a modal (chat-dock.css).
// The conversation lives only in the Dispatch store's memory (no disk, localStorage or logs).
// #954: an issue row (askAboutIssue) opens the dock on the helper with the issue pinned and asks for a proposal; the
// work reaches a lead only through 시작하기 under the answer (one press, locked synchronously like sendOnce).
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { api, connect, getState, loadTranscript, useDispatch } from '../dispatch/store';
import type { Session } from '../../../shared/dispatch/types.ts';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { badgeText, chatTargets, helperBody, HELPER_KEY, HELPER_OFFLINE, helperOffline, replies, sendOnce, sessionGone, unread } from './lib/chatDock.ts';
import { answeredAsk, issueAskText, runStart, startGate, useAskRequest, type AskRequest, type StartState } from './lib/askIssue.ts';
import { issueTask, newLeadBody, type TeamPick } from '../home/issueStart.ts';
import { IssueStartBar } from './IssueAsk';
import './chat-dock.css';

const ChatPane = lazy(() => import('./ChatPane'));

/** `folder`: the project shown (a top-level workspace folder); the helper works for it. */
export function ChatDock({ folder }: { folder: string | null }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  // Memory only: the helper's id, the picked partner, the draft and how many replies were seen per session.
  const [helperId, setHelperId] = useState<string | null>(null);
  const [key, setKey] = useState(HELPER_KEY);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Record<string, number>>({});
  // One send at a time, checked synchronously (sendOnce); `busy` only drives the UI.
  const sending = useRef(false);
  // #954: the issue pinned at the top, and its 시작하기 state; `gate` is the per-ask one-press lock and result filter.
  const [pin, setPin] = useState<AskRequest | null>(null);
  const [start, setStart] = useState<StartState>({ state: 'idle' });
  const gate = useRef(startGate()).current;
  const handled = useRef(0);
  const asked = useAskRequest();
  const ref = useRef<HTMLDialogElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // The store is fed only once the dock is used (opened or a conversation started), not on every page.
  const active = open || helperId !== null || key !== HELPER_KEY;
  useEffect(() => (active ? connect() : undefined), [active]);
  const unavailable = useDispatch(st => st.unavailable);
  const sessions = useDispatch(st => st.sessions);
  const providers = useDispatch(st => st.providers);
  const targets = useMemo(() => chatTargets(sessions, helperId), [sessions, helperId]);
  // A partner that ended drops out of the list; the helper takes its place.
  const target = targets.find(t => t.key === key) ?? targets[0]!;
  const sid = target.id;
  const s: Session | undefined = sid ? sessions.find(x => x.id === sid) : undefined;
  const entries = useDispatch(st => (sid ? st.transcripts[sid] : undefined));
  // Claude not connected: say so before the first send instead of failing on it.
  const offline = helperOffline(target, providers);

  useEffect(() => {
    if (sid && !getState().transcripts[sid]) loadTranscript(sid).catch((e: Error) => setError(e.message));
  }, [sid]);

  // What is on screen while the window is open counts as read.
  const count = replies(entries);
  useEffect(() => {
    if (open && sid && seen[sid] !== count) setSeen(m => ({ ...m, [sid]: count }));
  }, [open, sid, count, seen]);
  const badge = !open && sid && seen[sid] !== undefined ? unread(entries, seen[sid]) : 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const shown = el.matches(':popover-open');
    if (open && !shown) el.showPopover();
    else if (!open && shown) el.hidePopover();
  }, [open]);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => fab.current?.focus({ preventScroll: true }));
  };
  const toggle = () => {
    if (open) return close();
    setOpened(true);
    setOpen(true);
  };

  /** Sends `text` to session `to`, or makes the helper with it when `to` is null. Returns whether it went out. */
  const deliver = async (text: string, to: string | null) => {
    let ok = false;
    const ran = await sendOnce(sending, async () => {
      setBusy(true);
      setError(null);
      // The box clears at once; a failed send puts the text back.
      setDraft('');
      try {
        if (to) {
          await api('POST', `/api/sessions/${encodeURIComponent(to)}/message`, { text });
        } else {
          const res = await api<{ sessions: Session[] }>('POST', '/api/sessions', helperBody(text, folder));
          const made = res.sessions[0]?.id;
          if (made) {
            setHelperId(made);
            setKey(HELPER_KEY);
            loadTranscript(made).catch(() => {});
          }
        }
        ok = true;
      } catch (e) {
        setDraft(text);
        setError((e as Error).message);
        // A helper that is gone (removed elsewhere) is made again on the next send; a passing error keeps it.
        if (to && to === helperId && sessionGone(e)) setHelperId(null);
      } finally {
        setBusy(false);
      }
    });
    // Another send in flight: keep the text in the box instead of dropping it.
    if (!ran) setDraft(text);
    return ok;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || offline) return;
    await deliver(text, sid);
  };

  // An issue row asked about an issue: open on the helper (or the team's lead), pin the card, prefill the question.
  useEffect(() => {
    if (!asked || asked.seq === handled.current) return;
    handled.current = asked.seq;
    setPin(asked);
    gate.pin(asked.seq);
    setStart({ state: 'idle' });
    setError(null);
    setOpened(true);
    setOpen(true);
    // A partner not in the list (not loaded yet, or ended) falls back to the helper (see `target`).
    setKey(asked.partner ?? HELPER_KEY);
    if (!asked.ask) return;
    // Opening an issue never calls the model by itself (2026-11-20): the proposal question waits in the box, and
    // the person sends it (or edits it) when they want an answer.
    setDraft(issueAskText(asked.issue.number));
    // Runs once per request (seq); the other values are read as they are at that moment.
  }, [asked]);

  const startIssue = (team: TeamPick, leadId: string) => {
    if (!pin) return;
    const issue = { number: pin.issue.number, title: pin.issue.title };
    return runStart(gate, pin.seq, async () => {
      if (leadId) {
        await api('POST', `/api/sessions/${encodeURIComponent(leadId)}/message`, { text: issueTask(issue, team) });
        const name = sessions.find(x => x.id === leadId)?.name ?? '관리자';
        return `${name}에게 보냈어요. 곧 팀원을 만들어요.`;
      }
      const { default: rules } = await import('../../../plugin/skills/atelier-team/reference/rules.md?raw');
      await api('POST', '/api/sessions', newLeadBody(issue, team, rules, folder));
      return '새 관리자를 만들었어요. 곧 팀원을 만들어요.';
    }, setStart);
  };

  if (unavailable) return null;
  // Waiting for the answer: our request in flight, a helper that is being made, or the session's turn running.
  const thinking = busy || (helperId !== null && key === HELPER_KEY && !s) || s?.status === 'running' || s?.status === 'starting';
  // The 시작하기 bar: under the helper's answer to the ask, while the helper is not mid-turn (kept once pressed).
  const showBar = !!pin?.ask && key === HELPER_KEY && !!s && (start.state !== 'idle' || (!thinking && answeredAsk(entries, pin.issue.number)));
  const label = badge ? `채팅 열기, 읽지 않은 답 ${badge}개` : '채팅 열기';

  return (
    <>
      <button
        ref={fab}
        type="button"
        className={cn('chat-dock-fab', FOCUS_RING)}
        aria-label={open ? '채팅 닫기' : label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <MessageCircle aria-hidden className="size-5" />
        {badge > 0 && <span aria-hidden className="chat-dock-badge">{badgeText(badge)}</span>}
      </button>
      <dialog
        ref={ref}
        popover="manual"
        className="chat-dock-window"
        aria-labelledby={titleId}
        onKeyDown={e => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            close();
          }
        }}
      >
        {opened && (
          <Suspense fallback={<p className="chat-dock-muted">불러오는 중이에요…</p>}>
            <ChatPane
              titleId={titleId}
              open={open}
              targets={targets}
              target={target}
              onPick={k => { setKey(k); setError(null); }}
              session={s}
              thinking={thinking}
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              notice={offline ? HELPER_OFFLINE : null}
              error={error}
              setError={setError}
              onSend={() => void send()}
              onClose={close}
              issue={pin?.issue ?? null}
              after={showBar ? focusInput => (
                <IssueStartBar
                  key={pin!.seq}
                  // The helper is a lead-level session too; it proposes, it does not take the work.
                  sessions={sessions.filter(x => x.id !== helperId)}
                  state={start}
                  onStart={(team, leadId) => void startIssue(team, leadId)}
                  onRevise={focusInput}
                />
              ) : undefined}
            />
          </Suspense>
        )}
      </dialog>
    </>
  );
}
