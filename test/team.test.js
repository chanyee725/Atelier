// atelier-team team.sh presets and per-role models (#825). team.sh runs from a temp plugin tree with a fake
// start.sh against a stub HTTP server that records POST /api/sessions bodies; no real server or CLI runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = new URL('../plugin/', import.meta.url).pathname;

async function runTeam(preset, env) {
  const posts = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/api/state') return res.end(JSON.stringify({ providers: { claude: { connected: true } }, sessions: [] }));
      if (req.method === 'POST' && req.url === '/api/sessions') {
        const body = JSON.parse(b);
        posts.push(body);
        return res.end(JSON.stringify({ sessions: body.items.map((i) => ({ name: `S${++n}`, model: i.model ?? `default-${i.role}`, branch: `dispatch/${i.role}-${n}`, id: `id-${n}` })) }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'atelier-team-'));
  try {
    const skill = join(dir, 'plugin/skills/atelier-team');
    mkdirSync(join(skill, 'scripts'), { recursive: true });
    mkdirSync(join(skill, 'reference'));
    mkdirSync(join(dir, 'plugin/scripts'));
    copyFileSync(join(SRC, 'skills/atelier-team/scripts/team.sh'), join(skill, 'scripts/team.sh'));
    copyFileSync(join(SRC, 'skills/atelier-team/reference/rules.md'), join(skill, 'reference/rules.md'));
    writeFileSync(join(dir, 'plugin/scripts/start.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(dir, 'plugin/scripts/start.sh'), 0o755);
    const r = await new Promise((resolve) => {
      const c = spawn('bash', [join(skill, 'scripts/team.sh'), dir, preset, 'Issue #1'], {
        env: { ...process.env, DISPATCH_PORT: String(server.address().port), DISPATCH_TEAM_MODEL: '', DISPATCH_TEAM_MODE: '', ...env },
      });
      let stdout = '';
      let stderr = '';
      c.stdout.on('data', (d) => (stdout += d));
      c.stderr.on('data', (d) => (stderr += d));
      c.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    return { ...r, posts };
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const roles = (posts) => posts.flatMap((p) => p.items.map((i) => i.role));

test('team.sh small preset: lead, then impl, review and a tester as its children; role defaults pick the models', async () => {
  const r = await runTeam('small', { DISPATCH_TEAM_ROLE_MODELS: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(roles(r.posts), ['lead', 'impl', 'review', 'test']);
  assert.equal(r.posts[1].parent, 'id-1');
  assert.ok(r.posts.every((p) => p.items.every((i) => !('model' in i))), 'no model override without env');
  assert.ok(r.posts.every((p) => !('mode' in p)), 'no mode without DISPATCH_TEAM_MODE');
});

test('team.sh DISPATCH_TEAM_ROLE_MODELS sets only the named roles; DISPATCH_TEAM_MODEL still wins for all', async () => {
  const r = await runTeam('small', { DISPATCH_TEAM_ROLE_MODELS: '{"impl":"gemini-3.8-flash-high"}' });
  assert.equal(r.status, 0, r.stderr);
  const byRole = Object.fromEntries(r.posts.flatMap((p) => p.items).map((i) => [i.role, i.model]));
  assert.deepEqual(byRole, { lead: undefined, impl: 'gemini-3.8-flash-high', review: undefined, test: undefined });

  const all = await runTeam('small', { DISPATCH_TEAM_ROLE_MODELS: '{"impl":"gemini-3.8-flash-high"}', DISPATCH_TEAM_MODEL: 'claude-haiku-5-5' });
  assert.ok(all.posts.flatMap((p) => p.items).every((i) => i.model === 'claude-haiku-5-5'));
});

test('team.sh refuses DISPATCH_TEAM_ROLE_MODELS that is not JSON before creating any session', async () => {
  const r = await runTeam('small', { DISPATCH_TEAM_ROLE_MODELS: 'impl=gemini' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DISPATCH_TEAM_ROLE_MODELS is not JSON/);
  assert.equal(r.posts.length, 0);
});

test('team.sh DISPATCH_TEAM_MODE sends that mode with every create call (#856); an unknown mode makes nothing', async () => {
  const r = await runTeam('small', { DISPATCH_TEAM_MODE: 'research' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.posts.map((p) => p.mode), ['research', 'research']);
  const bad = await runTeam('small', { DISPATCH_TEAM_MODE: 'search' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /DISPATCH_TEAM_MODE is one of/);
  assert.equal(bad.posts.length, 0);
});
