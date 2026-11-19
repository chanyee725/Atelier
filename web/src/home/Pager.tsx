// Paging for dashboard row lists (#800): a hook that picks how many rows fit and keeps the current page, and a small
// 이전 / 1 2 3 / 다음 pager. Source-agnostic: the issue list uses it for GitHub issues and would for GitLab ones too.
import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { clampPage, pageCount, pageSlice, pagerItems, rowsThatFit } from './paging';

type Fit = {
  /** One row's height in px, divider included. */
  rowHeight: number;
  /** Space kept below the list (pager, card and page padding), px. */
  reserve: number;
  min: number;
  max: number;
  /** True while the list is on screen; the observers attach when it turns true. */
  active: boolean;
};

/**
 * Rows a page that fit between the list's top and the bottom of its scroll pane (the closest <main>, else the window),
 * measured again when the window or the list's column resizes.
 */
export function useFitRows(ref: RefObject<HTMLElement | null>, { rowHeight, reserve, min, max, active }: Fit): number {
  const [size, setSize] = useState(max);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const pane = el.closest('main');
    const paneTop = pane ? pane.getBoundingClientRect().top : 0;
    const paneHeight = pane ? pane.clientHeight : window.innerHeight;
    // Distance from the pane's content top, so a scrolled pane measures the same as an unscrolled one.
    const top = el.getBoundingClientRect().top - paneTop + (pane?.scrollTop ?? 0);
    setSize(rowsThatFit(paneHeight - top - reserve, rowHeight, min, max));
  }, [ref, rowHeight, reserve, min, max]);
  useLayoutEffect(measure);
  useEffect(() => {
    const el = ref.current;
    // The pane (window-driven) and the column (a card above growing moves the list down).
    const watched = [el?.closest('main'), el?.closest('[role=region]')].filter((x): x is Element => !!x);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    for (const w of watched) ro?.observe(w);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, measure, active]);
  return size;
}

/**
 * Rows a page that fit in `ref`'s own height (#819), for a list box that fills the rest of its card. Measured only while
 * the box scrolls (overflow-y auto: the dashboard side by side); otherwise, e.g. stacked on a phone where the box is as
 * tall as its rows, the page keeps `fallback` rows so opening a row's details never changes the page size.
 */
export function useBoxRows(ref: RefObject<HTMLElement | null>, { rowHeight, min, max, fallback }: { rowHeight: number; min: number; max: number; fallback: number }): number {
  const [size, setSize] = useState(fallback);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (getComputedStyle(el).overflowY !== 'auto') return setSize(fallback);
    // The last row has no divider below it, so the box holds one pixel more than whole rows.
    setSize(rowsThatFit(el.clientHeight + 1, rowHeight, min, max));
  }, [ref, rowHeight, min, max, fallback]);
  useLayoutEffect(measure);
  useEffect(() => {
    const el = ref.current;
    const ro = typeof ResizeObserver === 'undefined' || !el ? null : new ResizeObserver(() => measure());
    if (el) ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, measure]);
  return size;
}

/** The current page of `rows`; back to page 1 whenever `resetKey` (the filter or sort) changes. */
export function usePaging<T>(rows: readonly T[], size: number, resetKey: string) {
  const [state, setState] = useState({ page: 1, key: resetKey });
  // Reset during render (React's "adjust state on prop change"), so the old page never paints with the new filter.
  if (state.key !== resetKey) setState({ page: 1, key: resetKey });
  const page = clampPage(state.key === resetKey ? state.page : 1, rows.length, size);
  return {
    page,
    count: pageCount(rows.length, size),
    shown: pageSlice(rows, page, size),
    setPage: (p: number) => setState({ page: clampPage(p, rows.length, size), key: resetKey }),
  };
}

const BTN =
  'inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-sm px-1.5 text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';

/** 이전 / 1 2 3 / 다음 under a list; renders nothing for a single page. */
export function Pager({ page, count, onPage, label, className }: { page: number; count: number; onPage: (p: number) => void; label: string; className?: string }) {
  if (count <= 1) return null;
  return (
    <nav aria-label={label} data-pager className={cn('flex items-center justify-center gap-1 border-t px-3 py-1.5', className)}>
      <button type="button" className={BTN} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft aria-hidden className="size-3.5" /> 이전
      </button>
      <ul className="m-0 flex list-none items-center gap-0.5 p-0">
        {pagerItems(page, count).map((it, i) =>
          it === 'gap' ? (
            <li key={`gap-${i}`} aria-hidden className="px-1 text-xs text-muted-foreground">…</li>
          ) : (
            <li key={it}>
              <button
                type="button"
                className={cn(BTN, it === page && 'bg-accent font-medium text-foreground')}
                aria-current={it === page ? 'page' : undefined}
                aria-label={`${it}쪽`}
                onClick={() => onPage(it)}
              >
                {it}
              </button>
            </li>
          ),
        )}
      </ul>
      <button type="button" className={BTN} disabled={page >= count} onClick={() => onPage(page + 1)}>
        다음 <ChevronRight aria-hidden className="size-3.5" />
      </button>
    </nav>
  );
}
