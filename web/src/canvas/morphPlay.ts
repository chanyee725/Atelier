// Runs the animation of a morph (diagramMotion.ts markup) with the Web Animations API: opacity and transform only, so
// it stays on the compositor. Resolves when it has finished or was cancelled; the caller then drops the overlay.
import { MOTION_EASING, MOTION_MS, motionMs } from '../lib/liveMotion.ts';

export interface MorphRun {
  done: Promise<void>;
  cancel: () => void;
}

export function playMorph(root: Element, reduced: boolean): MorphRun {
  const els = [...root.querySelectorAll<SVGGraphicsElement>('[data-m]')];
  const anims: Animation[] = [];
  const dur = (ms: number) => motionMs(ms, reduced);
  const run = (el: Element, frames: Keyframe[], ms: number, delay = 0) => {
    if (typeof el.animate !== 'function') return;
    anims.push(el.animate(frames, { duration: dur(ms), delay, easing: MOTION_EASING, fill: 'both' }));
  };
  for (const el of els) {
    el.style.transformBox = 'fill-box';
    el.style.transformOrigin = 'center';
    switch (el.getAttribute('data-m')) {
      case 'enter':
        run(el, [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'scale(1)' }], MOTION_MS.enter);
        break;
      case 'change-in':
        run(el, [{ opacity: 0 }, { opacity: 1 }], MOTION_MS.enter);
        break;
      case 'exit':
      case 'change-out':
        run(el, [{ opacity: 1 }, { opacity: 0 }], MOTION_MS.exit);
        break;
      case 'move': {
        const dx = Number(el.getAttribute('data-dx')) || 0;
        const dy = Number(el.getAttribute('data-dy')) || 0;
        run(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], MOTION_MS.move);
        break;
      }
    }
  }
  const done = Promise.allSettled(anims.map((a) => a.finished)).then(() => undefined);
  return { done, cancel: () => anims.forEach((a) => a.cancel()) };
}
