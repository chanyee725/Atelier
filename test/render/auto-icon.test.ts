import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoIconFor, labelWords } from '../../shared/render/auto-icon.ts';
import { loadIconNames } from '../../shared/render/icon-registry.ts';
import { renderDiagram } from '../../shared/render/index.ts';

const icons = (svg: string): string[] => [...svg.matchAll(/data-icon="([^"]+)" data-icon-set="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);

test('labels split into words; .js / .io stay part of the name', () => {
  assert.deepEqual(labelWords('Node.js API'), ['nodejs', 'api']);
  assert.deepEqual(labelWords('Google Cloud SQL'), ['google', 'cloud', 'sql']);
  assert.deepEqual(labelWords('  '), []);
});

test('product labels get their logo or cloud icon', async () => {
  await loadIconNames();
  const want: [string, string][] = [
    ['Postgres DB', 'postgres'],
    ['PostgreSQL', 'postgresql'],
    ['Redis cache', 'redis'],
    ['Node.js', 'nodejs'],
    ['Kubernetes cluster', 'kubernetes'],
    ['Docker', 'docker'],
    ['AWS Lambda', 'aws-lambda'],
    ['Amazon S3', 'aws-s3'],
    ['Amazon DynamoDB', 'aws-dynamodb'],
    ['Amazon DynamoDB table', 'aws-dynamodb-table'],
    ['Google Cloud SQL', 'gcp-cloud-sql'],
    ['GCP BigQuery', 'gcp-bigquery'],
    ['Azure Cosmos DB', 'azure-cosmos-db'],
    ['Microsoft Azure Virtual Machine', 'azure-virtual-machine'],
    ['S3', 'aws-s3'],
    ['BigQuery', 'gcp-bigquery'],
  ];
  for (const [label, icon] of want) assert.equal(autoIconFor(label), icon, label);
});

test('plain labels and everyday words stay without an icon', async () => {
  await loadIconNames();
  for (const label of ['Next step', 'Go', 'Box', 'Users', 'Database', 'Web App', 'Payments', 'Auth', 'API Gateway', 'Start', 'Frontend', 'Node', 'Check order status', 'Redis and Postgres sync job', 'AWS', 'Azure', '']) {
    assert.equal(autoIconFor(label), undefined, label);
  }
});

test('nodes without icon: get one from the label; an explicit icon always wins; autoIcons off turns it off', async () => {
  const on = await renderDiagram('Postgres DB\nOrders [icon: users]\nRedis [icon: aws-elasticache]\nNext step', { type: 'cloud-architecture' });
  assert.deepEqual(icons(on.svg).sort(), ['aws-elasticache:aws', 'postgres:simple-icons', 'users:lucide']);
  const off = await renderDiagram('autoIcons off\nPostgres DB\nOrders [icon: users]', { type: 'cloud-architecture' });
  assert.deepEqual(icons(off.svg), ['users:lucide']);
  assert.deepEqual(off.diagnostics, []);
  const flow = await renderDiagram('Kafka topic > Postgres DB', { type: 'flowchart' });
  assert.deepEqual(icons(flow.svg), ['postgres:simple-icons']);
});

test('vendor artwork draws inside its icon box in its own colours; the dark canvas maps them', async () => {
  const light = await renderDiagram('Web [icon: aws-ec2]', { type: 'cloud-architecture' });
  const g = /<g data-icon="aws-ec2" data-icon-set="aws" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">(.*?)<\/g><\/g>/.exec(light.svg);
  assert.ok(g, 'aws-ec2 artwork');
  assert.equal(Number(g[3]), 20 / 80, 'an 80-unit icon fits the 20px card icon');
  assert.match(g[4]!, /fill="#ed7100"/);
  const mapped = await renderDiagram('Web [icon: aws-ec2]', { type: 'cloud-architecture', mapColor: (c: string) => (c === '#ed7100' ? '#123456' : c) });
  assert.match(mapped.svg, /fill="#123456"/);
});

test('sequence and ERD load explicit cloud icons before painting', async () => {
  const seq = await renderDiagram('Client [icon: gcp-cloud-run]\nClient > API: call', { type: 'sequence' });
  assert.ok(icons(seq.svg).includes('gcp-cloud-run:gcp'));
  const erd = await renderDiagram('users [icon: azure-sql-database] {\n  id string pk\n}', { type: 'erd' });
  assert.ok(icons(erd.svg).includes('azure-sql-database:azure'));
});
