// atelier-team relay.sh (#823): start the next team first, then remove the old lead's teammates and the lead last.
// A stub HTTP server stands in for Atelier and DISPATCH_TEAM_SH for team.sh; no real server or CLI runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RELAY = new URL('../plugin/skills/atelier-team/scripts/relay.sh', import.meta.url).pathname;

const SESSIONS = [
  { id: 'lead-a', name: 'Dino', canSpawn: true, parent: null },
  { id: 'impl-a', name: 'Iris', canSpawn: false, parent: 'lead-a' },
  { id: 'rev-a', name: 'Gus', canSpawn: false, parent: 'lead-a' },
  { id: 'lead-b', name: 'Ruby', canSpawn: true, parent: null },
  { id: 'impl-b', name: 'Vic', canSpawn: false, parent: 'lead-b' },
];

async function withStub(fn) {
  const removed = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/state') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ sessions: SESSIONS }));
    }
    const m = req.method === 'POST' && req.url.match(/^\/api\/sessions\/([^/]+)\/remove$/);
    if (m && req.headers['x-dispatch'] === '1') {
      removed.push(m[1]);
      return res.end('{"ok":true}');
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'atelier-relay-'));
  try {
    return await fn({ port: server.address().port, dir, removed });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeTeam(dir, exitCode) {
  const p = join(dir, 'team.sh');
  writeFileSync(p, `#!/bin/sh\nprintf '%s|%s|%s|%s' "$DISPATCH_PORT" "$1" "$2" "$3" > "${dir}/team-args"\necho "New\\tclaude-sonnet-5-5\\tdispatch/lead-9"\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return p;
}

function run(args, env) {
  return new Promise((resolve) => {
    const c = spawn('bash', [RELAY, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.stderr.on('data', (d) => (stderr += d));
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('relay.sh starts the new team, then removes only that lead\'s teammates and the lead last', () =>
  withStub(async ({ port, dir, removed }) => {
    const r = await run([dir, 'Dino', 'small', 'Issues #705, #715'], { DISPATCH_PORT: String(port), DISPATCH_TEAM_SH: fakeTeam(dir, 0) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dispatch\/lead-9/);
    assert.equal(readFileSync(join(dir, 'team-args'), 'utf8'), `${port}|${dir}|small|Issues #705, #715`);
    assert.deepEqual(removed, ['impl-a', 'rev-a', 'lead-a']);
  }));

test('relay.sh keeps the old team when the new team does not start', () =>
  withStub(async ({ port, dir, removed }) => {
    const r = await run([dir, 'Dino', 'small', 'Issue #705'], { DISPATCH_PORT: String(port), DISPATCH_TEAM_SH: fakeTeam(dir, 1) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /old team is kept/);
    assert.deepEqual(removed, []);
  }));

test('relay.sh with an empty task only removes the old team; port comes from .atelier/server.port', () =>
  withStub(async ({ port, dir, removed }) => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, '.atelier'));
    writeFileSync(join(dir, '.atelier', 'server.port'), `${port}\n`);
    const r = await run([dir, 'Ruby', 'small', ''], { DISPATCH_PORT: '', DISPATCH_TEAM_SH: fakeTeam(dir, 0) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(dir, 'team-args')), false, 'no new team for an empty task');
    assert.deepEqual(removed, ['impl-b', 'lead-b']);
  }));

test('relay.sh refuses an unknown lead without starting or removing anything', () =>
  withStub(async ({ port, dir, removed }) => {
    const r = await run([dir, 'Nobody', 'small', 'Issue #1'], { DISPATCH_PORT: String(port), DISPATCH_TEAM_SH: fakeTeam(dir, 0) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No lead named "Nobody"\. Leads: Dino, Ruby/);
    assert.equal(existsSync(join(dir, 'team-args')), false);
    assert.deepEqual(removed, []);
  }));
