import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ICON_ALIASES, ICON_FILES } from '../../shared/render/icon-index.ts';
import { iconFile, iconNames, loadIcons, parseIconFile, setIconLoader } from '../../shared/render/icon-library.ts';
import { iconFor } from '../../shared/render/icons.ts';
import { renderDiagram } from '../../shared/render/index.ts';
// @ts-expect-error plain .mjs build script without types
import { cleanSvg, looseKey, slugify } from '../../scripts/import-icons.mjs';

const ICONS = fileURLToPath(new URL('../../web/icons/', import.meta.url));
const fsLoader = async (file: string): Promise<string> => readFileSync(`${ICONS}${file}.svg`, 'utf8');

test('the index and the vendored files match one to one, and every alias points at a file', () => {
  for (const [set, { keys }] of Object.entries(ICON_FILES)) {
    const files = readdirSync(`${ICONS}${set}`).map((f) => f.replace(/\.svg$/, '')).sort();
    assert.deepEqual(keys.split(' ').sort(), files, set);
  }
  const all = new Set(Object.entries(ICON_FILES).flatMap(([set, { keys }]) => keys.split(' ').map((k) => `${set}/${k}`)));
  for (const pair of ICON_ALIASES.split(' ')) assert.ok(all.has(pair.split('=')[1]!), pair);
  assert.ok(iconNames().size > 6000);
});

test('every vendored file is in the shape the renderer accepts', () => {
  for (const set of Object.keys(ICON_FILES)) {
    for (const f of readdirSync(`${ICONS}${set}`)) {
      const art = parseIconFile(readFileSync(`${ICONS}${set}/${f}`, 'utf8'));
      assert.ok(art, `${set}/${f}`);
      assert.equal(art.kind === 'color', ['aws', 'azure', 'gcp'].includes(set), `${set}/${f}`);
    }
  }
});

test('names resolve with separators and case ignored, Eraser names included', () => {
  assert.equal(iconFile('aws-ec2'), 'aws/ec2');
  assert.equal(iconFile('AWS_EC2'), 'aws/ec2');
  assert.equal(iconFile('postgresql'), 'simple/postgresql');
  assert.equal(iconFile('azure-virtual-machine'), 'azure/virtual-machine');
  assert.equal(iconFile('gcp-bigquery'), 'gcp/bigquery');
  assert.equal(iconFile('alert-circle'), 'lucide/circle-exclamation-point');
  assert.equal(iconFile('aws-elb-application-load-balancer')?.startsWith('aws/elastic-load-balancing'), true);
  for (const k of ['constructor', '__proto__', 'toString']) assert.equal(iconFile(k), undefined, k);
});

test('parseIconFile refuses markup the import script never writes', () => {
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" data-kind="color">';
  assert.ok(parseIconFile(`${head}<path d="M0 0h1"/></svg>`));
  assert.equal(parseIconFile(`${head}<script>alert(1)</script></svg>`), null);
  assert.equal(parseIconFile(`${head}<image href="https://x.test/a.png"/></svg>`), null);
  assert.equal(parseIconFile(`${head}<use href="https://x.test/a.svg#x"/></svg>`), null);
  assert.equal(parseIconFile(`${head}<path d="M0 0" onload="x()"/></svg>`), null);
  assert.equal(parseIconFile(`${head}<path fill="url(https://x.test)" d="M0 0"/></svg>`), null);
  assert.equal(parseIconFile('<svg><path d="M0 0"/></svg>'), null);
});

test('import cleaning keeps shapes, turns classes into attributes, prefixes ids and refuses outside references', () => {
  const out = cleanSvg(
    '<?xml version="1.0"?><svg viewBox="0 0 10 10"><defs><style>.a{fill:#123456}</style><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
      '<title>t</title><path class="a" d="M1.123456 2L3 4"/><rect fill="url(#g)" width="1" height="1"/></svg>',
    'i-x-',
  );
  assert.match(out, /<path fill="#123456" d="M1.12 2L3 4"\/>/);
  assert.match(out, /<linearGradient id="i-x-0">/);
  assert.match(out, /fill="url\(#i-x-0\)"/);
  assert.doesNotMatch(out, /title|style|class/);
  assert.throws(() => cleanSvg('<svg viewBox="0 0 1 1"><script>x</script></svg>', 'p-'));
  assert.throws(() => cleanSvg('<svg viewBox="0 0 1 1"><image href="http://x"/></svg>', 'p-'));
  assert.throws(() => cleanSvg('<svg viewBox="0 0 1 1"><use href="http://x#a"/></svg>', 'p-'));
  assert.throws(() => cleanSvg('<svg viewBox="0 0 1 1"><path d="M0 0" fill="url(http://x)"/></svg>', 'p-'));
  assert.equal(slugify('Amazon-EC2-Auto-Scaling', ['amazon', 'aws']), 'ec2-auto-scaling');
  assert.equal(looseKey('database-for-postgresql-servers'), looseKey('database-postgresql-server'));
});

test('the third-party notice lists every set with version and licence', () => {
  const notice = readFileSync(`${ICONS}THIRD-PARTY.md`, 'utf8');
  for (const s of ['AWS Architecture Icons', 'Azure Architecture Icons', 'Google Cloud icons', 'Simple Icons', 'Lucide', 'CC0-1.0', 'ISC', 'V25', '07312026']) {
    assert.ok(notice.includes(s), s);
  }
});

test('a loaded cloud icon renders its own artwork; core names render without loading', async () => {
  assert.equal(iconFor('postgres').set, 'simple-icons');
  // Before loading, a cloud name falls back to a generic glyph.
  assert.equal(iconFor('aws-lambda').set, 'lucide');
  setIconLoader(fsLoader);
  try {
    const { svg } = await renderDiagram('fn [icon: aws-lambda]\ndb [icon: postgres]\nq [icon: azure-service-bus]\nfn > db', { type: 'cloud-architecture' });
    assert.match(svg, /data-icon="aws-lambda" data-icon-set="aws"[^>]*><svg width="24" height="24" viewBox="0 0 64 64"/);
    assert.match(svg, /data-icon="postgres" data-icon-set="simple-icons"/);
    assert.match(svg, /data-icon="azure-service-bus" data-icon-set="azure"/);
    assert.equal(await loadIcons(['aws-lambda']), false, 'already loaded');
  } finally {
    setIconLoader(null);
  }
});
