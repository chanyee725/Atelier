// The bell on the right of the top bar (E537 #654, moved by E579 #786): the unread count of the agent activity log plus
// the plans waiting for 시작하기 as a badge, and the feed in a popover="auto" (light dismiss, Esc). Opening the feed
// marks the activity read on every page; a waiting plan stays until it starts, is reopened or deleted. The feed is
// placed under the bell, right edges lined up, from JS (anchor positioning is not widely available).
import { useEffect, useId, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { badgeText, feedOf, placeFeed, unreadCount } from './activity';
import { planFolder, planTitle, planWaitingText } from './plans';
import { readAll, useActivityLog } from './store';
import { useWaitingPlans } from './waitingPlans';
import { requestPlanConfirm } from '../run/planConfirmRequest';
import './activity.css';

export function ActivityBell({ className, onOpen }: { className: string; onOpen: (path: string) => void }) {
  const log = useActivityLog();
  const id = useId();
  const bell = useRef<HTMLButtonElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const plans = useWaitingPlans();
  const unread = unreadCount(log);
  const badge = badgeText(unread + plans.length);
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
      readAll();
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
  // New events while the feed is open are seen as they come.
  useEffect(() => {
    if (open && unread) readAll();
  }, [open, unread]);
  // ...and their times are counted from now, not from when the feed opened.
  useEffect(() => {
    if (open) setNow(Date.now());
  }, [open, log]);

  const items = feedOf(log, now);
  const go = (file: string) => {
    feed.current?.hidePopover();
    onOpen(file);
  };
  // The plan's own strip opens the confirm once the document is loaded (same dialog as its 시작하기).
  const startPlan = (file: string) => {
    requestPlanConfirm(file);
    go(file);
  };
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
              {plans.map((p) => (
                <li key={p.path} className="activity-plan" data-plan-item={p.path}>
                  <span className="activity-dot" aria-hidden />
                  <span className="activity-plan-body">
                    <span className="activity-text">{planWaitingText(p)}</span>
                    <button type="button" className="activity-plan-link" onClick={() => go(p.path)}>
                      {planTitle(p)}
                    </button>
                    {planFolder(p.path) && <span className="activity-when">{planFolder(p.path)}</span>}
                  </span>
                  <button type="button" className="activity-plan-start" onClick={() => startPlan(p.path)}>
                    시작하기
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
        <h2 className="activity-feed-title">에이전트 활동</h2>
        {items.length === 0 ? (
          <p className="activity-empty">아직 기록이 없어요.</p>
        ) : (
          <ol className="activity-list">
            {items.map((it) => (
              <li key={it.id}>
                <button type="button" className="activity-item" data-activity-item={it.id} data-kind={it.kind} data-unread={it.unread ? '' : undefined} onClick={() => go(it.file)}>
                  <span className="activity-dot" aria-hidden style={it.color ? { background: it.color } : undefined} />
                  <span className="activity-text">{it.text}</span>
                  <span className="activity-when">{it.when}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
