import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMED_COLOR_NAMES, THEMES, resolvePaint } from '../../shared/render/theme.ts';
import type { Theme } from '../../shared/render/theme.ts';

// Independent oracle for WCAG relative luminance (deliberately not imported from theme.ts).
function lum(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('bold boxes keep readable text (dark: at least 4.5:1)', () => {
  for (const color of [undefined, ...NAMED_COLOR_NAMES]) {
    const p = resolvePaint({ color, mode: 'bold' }, 'dark');
    assert.ok(ratio(p.text, p.fill) >= 4.5, `${color ?? 'neutral'}: ${ratio(p.text, p.fill).toFixed(2)}`);
  }
});

// Light bold fills are mid-tones; a few (blue, red, pink, gray) stay under 4.5:1 with either text colour,
// so the rule there is: always the better of dark and white text.
for (const theme of ['light', 'dark'] as Theme[]) {
  test(`bold boxes use the better of dark and white text (${theme})`, () => {
    for (const color of [undefined, ...NAMED_COLOR_NAMES]) {
      const p = resolvePaint({ color, mode: 'bold' }, theme);
      const best = Math.max(ratio('#1f2329', p.fill), ratio('#ffffff', p.fill));
      assert.equal(ratio(p.text, p.fill), best, `${theme} ${color ?? 'neutral'}`);
    }
  });
}

// #935: a group without a colour shows its border at non-text contrast (3:1) on the dark canvas.
test('neutral group border reads at 3:1 on the canvas (dark)', () => {
  const p = resolvePaint({ mode: 'pastel' }, 'dark', true);
  const r = ratio(p.stroke, THEMES.dark.background);
  assert.ok(r >= 3, `dark group border ${p.stroke}: ${r.toFixed(2)}`);
});

// #1066 (user decision): the light theme takes Eraser's hairline group border instead; the group title
// still reads at text contrast, so the group does not depend on the border.
test('neutral group border is the Eraser hairline in light; the group title keeps 4.5:1', () => {
  assert.equal(resolvePaint({ mode: 'pastel' }, 'light', true).stroke, '#eaecf0');
  assert.ok(ratio(THEMES.light.groupText, THEMES.light.background) >= 4.5);
});
