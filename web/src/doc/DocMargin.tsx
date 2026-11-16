// Layout of the document with its agent margin (E532, issue #622). While agents edit the open document, a panel opens
// beside it (wide: a sticky side column, the document slides left) or under it (narrow: a sticky bottom sheet). The
// panel is a flex sibling of the text, so it never covers it; it takes no focus (mousedown does not move the caret);
// it fades in with @starting-style and is unmounted only after its exit transition. The document's slide is a FLIP:
// measured before and after the layout change, then animated with a translate (skipped under reduced motion).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { MarginPanel } from './MarginPanel';
import { useAgentMargin } from './marginStore';

/** Exit transition length (ms), a little over the CSS one, as the fallback if `transitionend` never comes. */
const EXIT_MS = 360;
const SLIDE = { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Props = {
  file: string;
  /** The document column; `onEditor` hands the editor up (stable for the life of the layout). */
  children: (onEditor: (editor: Editor | null) => void) => ReactNode;
};

export function DocMargin({ file, children }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const onEditor = useCallback((e: Editor | null) => setEditor(e), []);
  const host = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const m = useAgentMargin(file, editor, width);

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

  // Viewport width picks side panel or bottom sheet (the 둘 다 view widens the document pane for the panel); a
  // resize of the column also refreshes the FLIP's "before".
  useLayoutEffect(() => {
    const el = host.current;
    const onWin = () => setWidth(window.innerWidth);
    onWin();
    window.addEventListener('resize', onWin);
    const ro = el && typeof ResizeObserver === 'function' ? new ResizeObserver(() => (lefts.current = measure())) : null;
    if (el) ro?.observe(el);
    return () => {
      window.removeEventListener('resize', onWin);
      ro?.disconnect();
    };
  }, []);

  // While it fades out, the panel keeps showing who was there.
  const last = useRef(m.agents);
  if (m.open) last.current = m.agents;
  const onToggle = useCallback(() => m.setCollapsed(!m.collapsed), [m]);
  return (
    <div ref={host} className="doc-margin" data-form={m.form} data-margin-open={mounted && !closing ? '' : undefined} data-margin-mounted={mounted ? '' : undefined}>
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
          <MarginPanel agents={m.open ? m.agents : last.current} form={m.form} collapsed={m.collapsed} onToggle={onToggle} onJump={m.jump} />
        </aside>
      )}
    </div>
  );
}
