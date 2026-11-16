// The bell in the app sidebar's head (E537, #654): the unread count of the agent activity log as a badge, and the
// feed in a popover="auto" (light dismiss, Esc). Opening the feed marks everything read on every page. The feed is
// placed under the bell from JS (anchor positioning is not widely available), kept inside the viewport.
import { useEffect, useId, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { badgeText, feedOf, unreadCount } from './activity';
import { readAll, useActivityLog } from './store';
import './activity.css';

const GAP = 6;
const EDGE = 8;

/** Where the feed goes: under the bell, left-aligned, flipped above or shifted in when it would leave the viewport. */
export function placeFeed(bell: { left: number; top: number; bottom: number }, feed: { width: number; height: number }, view: { width: number; height: number }) {
  const left = Math.max(EDGE, Math.min(bell.left, view.width - feed.width - EDGE));
  const below = bell.bottom + GAP;
  const top = below + feed.height <= view.height - EDGE ? below : Math.max(EDGE, bell.top - GAP - feed.height);
  return { left, top };
}

export function ActivityBell({ className, onOpen }: { className: string; onOpen: (path: string) => void }) {
  const log = useActivityLog();
  const id = useId();
  const bell = useRef<HTMLButtonElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const unread = unreadCount(log);
  const badge = badgeText(unread);

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
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (!isOpen) return;
      setNow(Date.now());
      place();
      readAll();
    };
    el.addEventListener('toggle', onToggle);
    addEventListener('resize', place);
    return () => {
      el.removeEventListener('toggle', onToggle);
      removeEventListener('resize', place);
    };
  }, []);
  // New events while the feed is open are seen as they come.
  useEffect(() => {
    if (open && unread) readAll();
  }, [open, unread]);

  const items = feedOf(log, now);
  const go = (file: string) => {
    feed.current?.hidePopover();
    onOpen(file);
  };
  return (
    <>
      <button
        ref={bell}
        type="button"
        className={className + ' relative'}
        popoverTarget={id}
        aria-label={badge ? `에이전트 활동, 안 읽은 ${unread}개` : '에이전트 활동'}
        title="에이전트 활동"
        data-activity-bell=""
      >
        <Bell aria-hidden />
        {badge && (
          <span className="activity-badge" data-activity-badge="" aria-hidden>
            {badge}
          </span>
        )}
      </button>
      <div ref={feed} id={id} popover="auto" className="activity-feed" data-activity-feed="" aria-label="에이전트 활동">
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
