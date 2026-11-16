// Measures the room the document's agent margin has (E532, #622), for DocMargin (side panel or sheet) and the
// Splitter (keeping the divider under the pointer). Both read the same numbers, so they agree on the layout: the
// collapsed side panel is read from the one place that says so, DocMargin's `data-side-rail` attribute (DocMargin
// itself measures the open panel and counts the rail from its own state, so the form follows in the same render).
import type { MarginRoom } from './agentMargin.ts';

/**
 * The room around a `.doc-margin` element. While DocMargin marks it `data-side-rail` (the side panel is collapsed),
 * the panel is the rail; else it takes 4 of the row's 10 parts (E537, #654). `rail = false` measures the open panel
 * whatever the attribute says. In the 둘 다 view the document pane is the closest `.split-doc` (its `--split` is the
 * share).
 */
export function measureRoom(host: HTMLElement, rail = host.hasAttribute('data-side-rail')): MarginRoom {
  const own = host.getBoundingClientRect().width;
  const pane = host.closest<HTMLElement>('.split-doc');
  const split = pane?.parentElement;
  if (!pane || !split) return { box: own, share: null, chrome: 0, rail };
  const share = parseFloat(pane.style.getPropertyValue('--split')) / 100;
  return {
    box: split.getBoundingClientRect().width,
    share: Number.isFinite(share) ? share : 0.5,
    chrome: Math.max(0, pane.getBoundingClientRect().width - own),
    rail,
  };
}

/** The nearest ancestor that scrolls vertically (the margin's sticky panel is as tall as it at most). */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}
