import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeSvg } from '../../scripts/svg-sanitize.mjs';
import { allIconNames, loadIcons, packIcon, resolveName } from '../../shared/render/icon-registry.ts';
import { PACK_LOADERS } from '../../shared/render/icon-packs/loaders.ts';

test('sanitizer keeps shapes and gradients, drops scripts, styles, links and handlers', () => {
  const svg = `<?xml version="1.0"?><svg viewBox="0 0 18 18"><title>x</title><style>.a{fill:#0078D4}</style>
    <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
    <script>alert(1)</script><a href="https://example.com"><path d="M0 0h1"/></a>
    <path class="a" d="M1 1h4v4z" onclick="alert(1)"/><rect x="1" y="1" width="2" height="2" fill="url(#g1)" style="opacity:.5;behavior:url(x)"/>
    <image href="data:image/png;base64,AA"/><circle cx="3" cy="3" r="1" fill="javascript:alert(1)"/></svg>`;
  const { vb, body } = sanitizeSvg(svg, 'icon');
  assert.equal(vb, '0 0 18 18');
  assert.doesNotMatch(body, /script|style|href=|onclick|image|javascript|example\.com|title/);
  assert.match(body, /<linearGradient id="icon-0"/);
  assert.match(body, /<stop offset="0" stop-color="#ffffff"\/>/);
  assert.match(body, /<path fill="#0078d4" d="M1 1h4v4z"\/>/);
  assert.match(body, /<rect x="1" y="1" width="2" height="2" fill="url\(#icon-0\)" opacity=".5"\/>/);
  assert.match(body, /<circle cx="3" cy="3" r="1"\/>/);
});

test('sanitizer refuses a file with no drawing left', () => {
  assert.throws(() => sanitizeSvg('<svg viewBox="0 0 1 1"><script>x</script></svg>', 'x'), /no drawing/);
  assert.throws(() => sanitizeSvg('<p/>', 'x'), /no <svg> root/);
});

test('every vendored cloud icon is sanitized markup only', () => {
  for (const set of ['aws', 'azure', 'gcp']) {
    const v = JSON.parse(readFileSync(new URL(`../../shared/vendor/icons/${set}.json`, import.meta.url), 'utf8'));
    assert.ok(Object.keys(v.icons).length > 150, set);
    assert.ok(v.version && v.license && v.url, set);
    for (const [name, i] of Object.entries(v.icons) as [string, { vb: string; body: string }][]) {
      assert.match(name, new RegExp(`^${set}-[a-z0-9-]+$`), name);
      assert.match(i.vb, /^[-0-9. ]+$/, name);
      assert.doesNotMatch(i.body, /<\/?(script|style|image|foreignObject|use|a|text)\b|\son\w+=|href="(?!#)|url\((?!#)/i, name);
    }
  }
});

test('Eraser-style names resolve to the bundled sets; explicit aliases point at real icons', async () => {
  await loadIcons(['aws-ec2', 'aws-s3', 'azure-virtual-machine', 'gcp-bigquery', 'postgres', 'nodejs', 'k8s', 'users', 'alert-circle']);
  const want: [string, string, string][] = [
    ['aws-ec2', 'aws', 'aws-ec2'],
    ['aws-s3', 'aws', 'aws-simple-storage-service'],
    ['azure-virtual-machine', 'azure', 'azure-virtual-machine'],
    ['gcp-bigquery', 'gcp', 'gcp-bigquery'],
    ['postgres', 'simple', 'postgresql'],
    ['nodejs', 'simple', 'nodedotjs'],
    ['k8s', 'simple', 'kubernetes'],
    ['users', 'lucide', 'users'],
    ['alert-circle', 'lucide', 'circle-exclamation-point'],
  ];
  for (const [name, set, key] of want) {
    assert.deepEqual(resolveName(name), { set, key }, name);
    assert.equal(packIcon(name)?.key, key, name);
  }
  assert.equal(packIcon('aws-ec2')!.kind, 'art');
  assert.equal(packIcon('postgres')!.kind, 'fill');
  assert.equal(packIcon('users')!.kind, 'stroke');
  assert.equal(resolveName('vault')?.set, 'lucide', 'vault stays the generic glyph');
  for (const k of ['constructor', '__proto__', 'toString']) assert.equal(resolveName(k), undefined, k);
});

test('the full sets hold thousands of icons, every chunk loads, and nothing is fetched', async () => {
  const names = await allIconNames();
  assert.ok(names.length > 6000, String(names.length));
  for (const load of Object.values(PACK_LOADERS)) {
    const chunk = (await load()).default;
    assert.ok(Object.keys(chunk).length > 0);
  }
  for (const f of ['../../shared/render/icon-registry.ts', '../../shared/render/auto-icon.ts', '../../shared/render/icon-packs/loaders.ts']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /fetch\(|https?:\/\/(?!aws|learn|cloud|lucide|simpleicons)/, f);
  }
});

test('pack names and aliases do not replace curated icons for an explicit icon: name', async () => {
  const { iconFor } = await import('../../shared/render/icons.ts');
  const curated: [string, string][] = [
    ['vm', 'server'], ['chart', 'chart-column'], ['ingress', 'network'], ['node', 'server'],
    ['serverless', 'square-function'], ['composer', 'workflow'], ['ios', 'smartphone'],
    ['opensearch', 'search'], ['looker', 'chart-column'],
  ];
  await loadIcons([...curated.map(([n]) => n), 'aws-ec2', 'postgres']);
  for (const [n] of curated) assert.ok(packIcon(n), `${n} is also a pack name`);
  for (const [n, key] of curated) assert.deepEqual([n, iconFor(n).set, iconFor(n).key], [n, 'lucide', key]);
  assert.equal(iconFor('aws-ec2').set, 'aws');
  assert.equal(iconFor('postgres').key, 'postgresql');
});
