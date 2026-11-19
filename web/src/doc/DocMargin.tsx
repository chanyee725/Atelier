// Layout of the document with its agent margin (E532, issue #622). While agents edit the open document, a panel opens
// beside it (wide: a sticky side column, the document slides left) or under it (narrow: a sticky bottom sheet). The
// panel is a flex sibling of the text, so it never covers it; it takes no focus (mousedown does not move the caret);
// it fades in with @starting-style and is unmounted only after its exit transition. The document's slide is a FLIP:
// measured before and after the layout change, then animated with a translate (skipped under reduced motion).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { MarginPanel } from './MarginPanel';
import { useAgentMargin } from './marginStore';
import type { MarginRoom } from './agentMargin';
import { measureRoom, scrollerOf } from './marginRoom';

/** Exit transition length (ms), a little over the CSS one, as the fallback if `transitionend` never comes. */
const EXIT_MS = 360;
const SLIDE = { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Props = {
  file: string;
  /** Open questions in the document (#738): a badge in the agent area that scrolls to them. */
  questions?: number;
  onQuestions?: () => void;
  /** The document column; `onEditor` hands the editor up (stable for the life of the layout). */
  children: (onEditor: (editor: Editor | null) => void) => ReactNode;
};

export function DocMargin({ file, questions, onQuestions, children }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const onEditor = useCallback((e: Editor | null) => setEditor(e), []);
  const host = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const [room, setRoom] = useState<MarginRoom | null>(null);
  const m = useAgentMargin(file, editor, room);

  // Mounted from the moment it opens until its exit transition has played.
  const [mounted, setMounted] = useState(m.open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (m.open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const el = aside.current;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      setMounted(false);
      setClosing(false);
    };
    const onEnd = (ev: TransitionEvent) => {
      if (ev.target === el) end();
    };
    el?.addEventListener('transitionend', onEnd);
    const t = setTimeout(end, reduced() ? 0 : EXIT_MS);
    return () => {
      clearTimeout(t);
      el?.removeEventListener('transitionend', onEnd);
    };
  }, [m.open, mounted]);

  // FLIP of the document column: where each child of the column sat before the layout changed.
  const lefts = useRef<number[] | null>(null);
  const measure = () => (main.current ? [...main.current.children].map((c) => c.getBoundingClientRect().left) : null);
  const sideCollapsed = m.form === 'side' && m.collapsed;
  useLayoutEffect(() => {
    const before = lefts.current;
    const after = measure();
    lefts.current = after;
    if (!before || !after || reduced()) return;
    const kids = [...(main.current?.children ?? [])] as HTMLElement[];
    kids.forEach((el, i) => {
      const dx = (before[i] ?? after[i]) - after[i];
      if (Math.abs(dx) > 1 && typeof el.animate === 'function') el.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], SLIDE);
    });
  }, [mounted, closing, m.form, sideCollapsed]);

  // The room on the page (not the window: the app sidebar and the split share it) picks side panel or bottom sheet,
  // so the text keeps TEXT_MIN and, in 둘 다, the canvas CANVAS_MIN. Observed on the column, the document pane and the
  // split, which change with the sidebar, the divider and the window. A resize of the column also refreshes the FLIP's
  // "before", and the scroller's height caps the sticky panel's.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const scroller = scrollerOf(el);
    const update = () => {
      // The open panel's room: useAgentMargin counts a collapsed side panel as its rail in the same render.
      const next = measureRoom(el, false);
      setRoom((old) => (old && old.box === next.box && old.share === next.share && old.chrome === next.chrome && old.rail === next.rail ? old : next));
      lefts.current = measure();
      if (scroller) el.style.setProperty('--doc-margin-view-h', `${scroller.clientHeight}px`);
    };
    update();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(update);
    const pane = el.closest('.split-doc');
    for (const t of new Set([el, pane, pane?.parentElement, scroller])) if (t) ro.observe(t);
    return () => ro.disconnect();
  }, []);

  // While it fades out, the panel keeps showing who was there.
  const last = useRef(m.agents);
  if (m.open) last.current = m.agents;
  const onToggle = useCallback(() => m.setCollapsed(!m.collapsed), [m]);
  return (
    <div ref={host} className="doc-margin" data-form={m.form} data-side-rail={m.sideCollapsed ? '' : undefined} data-margin-open={mounted && !closing ? '' : undefined} data-margin-mounted={mounted ? '' : undefined}>
      <div ref={main} className="doc-margin-main">
        {children(onEditor)}
      </div>
      {mounted && (
        <aside
          ref={aside}
          className="doc-margin-aside"
          aria-label="문서를 고치는 에이전트"
          data-closing={closing ? '' : undefined}
          data-collapsed={m.collapsed ? '' : undefined}
          // Clicks here never take the caret out of the editor.
          onMouseDown={(e) => e.preventDefault()}
        >
          <MarginPanel agents={m.open ? m.agents : last.current} form={m.form} collapsed={m.collapsed} onToggle={onToggle} onJump={m.jump} questions={questions} onQuestions={onQuestions} />
        </aside>
      )}
    </div>
  );
}
