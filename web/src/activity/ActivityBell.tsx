// The bell on the right of the top bar (E537 #654, moved by E579 #786): the 알림함 (#797) — every app event and agent
// activity, newest first, with 모두 읽음 and 전체 삭제 in the head — plus the plans waiting for 시작하기. Each item
// shows who raised it (the agent's model mark and 이름 · 역할, else the app) and one action, 확인하기 (#811). The badge counts unread items and waiting plans. The feed is a popover="auto" (light dismiss, Esc), placed
// under the bell, right edges lined up, from JS (anchor positioning is not widely available).
import { useEffect, useId, useRef, useState } from 'react';
import { Bell, Bot, CheckCheck, ClipboardList, FileText, Plug, Settings, Trash2, Users, Workflow, type LucideIcon } from 'lucide-react';
import { badgeText, placeFeed, whenText } from './activity';
import { bellCount, inboxUnread, type InboxItem, type InboxKind, type InboxTarget } from './inbox';
import { clearAllInbox, readAllInbox, readInboxItem, useInbox } from './inboxStore';
import { planFolder, planTitle, planWaitingText } from './plans';
import { useWaitingPlans } from './waitingPlans';
import { requestPlanConfirm } from '../run/planConfirmRequest';
import { roleLabel } from '../run/overlayModel';
import { ProviderIcon, providerIcon } from '../ProviderIcon';
import './activity.css';

const ICON: Record<InboxKind, LucideIcon> = {
  agents: Bot,
  files: FileText,
  sessions: Users,
  models: Plug,
  runs: Workflow,
  settings: Settings,
  plan: ClipboardList,
};

/** Who raised the item: "Chan · 관리자" for an agent, the app's name otherwise. */
const whoOf = (i: InboxItem) => (i.agent ? [i.agent.name, i.agent.role && roleLabel(i.agent.role)].filter(Boolean).join(' · ') : 'Atelier');

/** The item's mark: the agent's model (provider) icon, a robot for an agent of unknown provider, else the kind's icon. */
function ItemMark({ item }: { item: InboxItem }) {
  if (item.agent && providerIcon(item.agent.provider)) return <ProviderIcon provider={item.agent.provider} className="activity-mark-icon" />;
  const Icon = item.agent ? Bot : ICON[item.kind];
  return <Icon className="activity-mark-icon" aria-hidden />;
}

/** onOpen: a document's path; onSession: a session id (opens it on the board). */
export function ActivityBell({ className, onOpen, onSession }: { className: string; onOpen: (path: string) => void; onSession: (id: string) => void }) {
  const inbox = useInbox();
  const id = useId();
  const bell = useRef<HTMLButtonElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const plans = useWaitingPlans();
  const unread = inboxUnread(inbox);
  const badge = badgeText(bellCount(inbox, plans.map((p) => p.path)));
  const label = [unread ? `안 읽은 ${unread}개` : '', plans.length ? `시작을 기다리는 계획 ${plans.length}개` : ''].filter(Boolean).join(', ');

  useEffect(() => {
    const el = feed.current;
    if (!el) return;
    const place = () => {
      const b = bell.current?.getBoundingClientRect();
      if (!b) return;
      const r = el.getBoundingClientRect();
      const at = placeFeed(b, r, { width: innerWidth, height: innerHeight });
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
    };
    // The feed has no size before it opens, so it is placed on `toggle`; hidden until then so it never shows a
    // frame at the default spot.
    const onBefore = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') el.style.visibility = 'hidden';
    };
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (!isOpen) return;
      setNow(Date.now());
      place();
      el.style.visibility = '';
    };
    el.addEventListener('beforetoggle', onBefore);
    el.addEventListener('toggle', onToggle);
    addEventListener('resize', place);
    return () => {
      el.removeEventListener('beforetoggle', onBefore);
      el.removeEventListener('toggle', onToggle);
      removeEventListener('resize', place);
    };
  }, []);
  // Times of items that come in while the feed is open are counted from now, not from when it opened.
  useEffect(() => {
    if (open) setNow(Date.now());
  }, [open, inbox]);

  const go = (file: string) => {
    feed.current?.hidePopover();
    onOpen(file);
  };
  // The plan's own strip opens the confirm once the document is loaded (same dialog as its 시작하기).
  const startPlan = (file: string) => {
    requestPlanConfirm(file);
    go(file);
  };
  const openItem = (i: InboxItem) => {
    readInboxItem(i.id);
    const t: InboxTarget | undefined = i.target;
    if (!t) return;
    if ('plan' in t) startPlan(t.plan);
    else if ('file' in t) go(t.file);
    else {
      feed.current?.hidePopover();
      onSession(t.session);
    }
  };
  const items = inbox.items;
  return (
    <>
      <button
        ref={bell}
        type="button"
        className={className + ' relative'}
        popoverTarget={id}
        aria-label={label ? `알림함, ${label}` : '알림함'}
        title="알림함"
        data-activity-bell=""
      >
        <Bell aria-hidden />
        {badge && (
          <span className="activity-badge" data-activity-badge="" aria-hidden>
            {badge}
          </span>
        )}
      </button>
      <div ref={feed} id={id} popover="auto" role="dialog" className="activity-feed" data-activity-feed="" aria-label="알림함">
        {plans.length > 0 && (
          <>
            <h2 className="activity-feed-title">시작을 기다리는 계획</h2>
            <ol className="activity-list" data-plan-inbox="">
              {plans.map((p, n) => (
                <li key={p.path} className="activity-plan" data-plan-item={p.path}>
                  <span className="activity-dot" aria-hidden />
                  <span className="activity-plan-body" id={`${id}-plan-${n}`}>
                    <span className="activity-text">{planWaitingText(p)}</span>
                    <span className="activity-plan-title">{planTitle(p)}</span>
                    {planFolder(p.path) && <span className="activity-when">{planFolder(p.path)}</span>}
                  </span>
                  <button type="button" className="activity-check" aria-describedby={`${id}-plan-${n}`} onClick={() => startPlan(p.path)} data-plan-open="">
                    확인하기
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
        <div className="activity-inbox-head">
          <h2 className="activity-feed-title">알림</h2>
          {items.length > 0 && (
            <span className="activity-inbox-actions">
              <button type="button" className="activity-inbox-action" onClick={readAllInbox} disabled={!unread} data-inbox-read-all="">
                <CheckCheck aria-hidden />
                모두 읽음
              </button>
              <button
                type="button"
                className="activity-inbox-action"
                onClick={() => {
                  clearAllInbox();
                  bell.current?.focus();
                }}
                data-inbox-clear=""
              >
                <Trash2 aria-hidden />
                전체 삭제
              </button>
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="activity-empty">아직 알림이 없어요.</p>
        ) : (
          <ol className="activity-list" data-inbox="">
            {items.map((it) => {
              // Ids hold no spaces (aria-describedby is a space-separated list).
              const text = `${id}-item-${it.id.replace(/\s/g, '_')}`;
              return (
                <li key={it.id} className="activity-inbox-row" data-inbox-row={it.id} data-kind={it.error ? 'error' : it.kind} data-unread={it.read ? undefined : ''}>
                  <span className="activity-mark" data-agent={it.agent ? '' : undefined} aria-hidden>
                    <ItemMark item={it} />
                  </span>
                  <div className="activity-inbox-body">
                    <p className="activity-who">
                      <span className="activity-name">{whoOf(it)}</span>
                      <span className="activity-when">{whenText(now - it.at, it.at)}</span>
                    </p>
                    <p className="activity-text" id={text}>
                      {!it.read && <span className="sr-only">읽지 않음, </span>}
                      {it.error && <span className="sr-only">오류, </span>}
                      {it.text}
                    </p>
                    <button type="button" className="activity-check" aria-describedby={text} onClick={() => openItem(it)} data-inbox-item={it.id}>
                      확인하기
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </>
  );
}
