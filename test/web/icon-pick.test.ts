import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchIcons, setLineIcon, SUGGESTED } from '../../web/src/dsl/iconPick.ts';
import { allIconNames } from '../../shared/render/icon-registry.ts';

test('setLineIcon adds, replaces or creates the icon on the cursor line', () => {
  const cases: [string, number, string][] = [
    ['Web', 0, 'Web [icon: aws-ec2]'],
    ['Web [color: blue]', 0, 'Web [icon: aws-ec2, color: blue]'],
    ['Web [color: blue, icon: server]', 0, 'Web [color: blue, icon: aws-ec2]'],
    ['Web [icon: "old one"]', 0, 'Web [icon: aws-ec2]'],
    ['Web [] // main', 0, 'Web [icon: aws-ec2] // main'],
    ['Web // main', 0, 'Web [icon: aws-ec2] // main'],
    ['VPC {', 0, 'VPC [icon: aws-ec2] {'],
    ['VPC [color: red] {', 0, 'VPC [icon: aws-ec2, color: red] {'],
    ['  Inner node', 0, '  Inner node [icon: aws-ec2]'],
  ];
  for (const [line, at, want] of cases) assert.deepEqual(setLineIcon(line, at, 'aws-ec2'), { code: want, line: 0 }, line);
  assert.deepEqual(setLineIcon('A\n\nB', 1, 'redis'), { code: 'A\nredis [icon: redis]\nB', line: 1 });
  assert.deepEqual(setLineIcon('A > B\nC', 0, 'redis'), { code: 'A > B\nredis [icon: redis]\nC', line: 1 });
  assert.deepEqual(setLineIcon('A -- B', 0, 'redis'), { code: 'A -- B\nredis [icon: redis]', line: 1 });
  assert.deepEqual(setLineIcon('A', 5, 'redis'), { code: 'A\nredis [icon: redis]', line: 1 });
  assert.deepEqual(setLineIcon('G {\r\n  A\r\n}', 1, 'redis'), { code: 'G {\r\n  A [icon: redis]\r\n}', line: 1 });
  assert.equal(setLineIcon('Web-Server', 0, 'x').code, 'Web-Server [icon: x]', 'a dash inside a name is not a connection');
});

test('searchIcons ranks exact and prefix matches first, one entry per icon, at most the limit', async () => {
  const entries = await allIconNames();
  assert.equal(searchIcons(entries, 'aws-ec2')[0]!.name, 'aws-ec2');
  assert.equal(searchIcons(entries, 'AWS EC2')[0]!.name, 'aws-ec2');
  const pg = searchIcons(entries, 'postgres');
  assert.equal(pg[0]!.name, 'postgres');
  assert.equal(pg.filter((e) => e.key === 'postgresql').length, 1, 'aliases of one icon show once');
  assert.ok(searchIcons(entries, 'cosmos').some((e) => e.name === 'azure-cosmos-db'));
  assert.ok(searchIcons(entries, 'a', 25).length === 25);
  assert.deepEqual(searchIcons(entries, 'zzzz-nothing'), []);
  assert.deepEqual(searchIcons(entries, '').map((e) => e.name), SUGGESTED, 'every suggestion is a real icon name');
});
