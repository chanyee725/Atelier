// Automatic icons for nodes written without `icon:` (#734). Conservative on purpose: a node gets an icon only
// when its label clearly names a product, so plain labels ("Next step", "Go", "Box") stay as they are.
//
// - A tech logo: the label is the product name, optionally followed by a generic role word
//   ("Postgres DB" → postgres, "Redis cache" → redis, "Node.js" → nodejs).
// - A cloud service: the label starts with the vendor ("AWS Lambda", "Amazon S3", "Google Cloud SQL",
//   "Azure Cosmos DB") and the longest following phrase is one of that vendor's icon names; or the label is one of
//   a few service names that only mean one thing ("S3", "DynamoDB", "BigQuery").
// Needs the name index (icon-registry `loadIconNames`); before it loads, nothing matches.

import type { DiagramBase, Diagram, GraphNode } from '../dsl/index.ts';
import { iconNamesLoaded, loadIconNames, loadIcons, resolveName } from './icon-registry.ts';

/** Role words allowed after a product name. */
const ROLE = new Set([
  'db', 'database', 'databases', 'server', 'servers', 'cluster', 'cache', 'queue', 'broker', 'api', 'service', 'services',
  'app', 'instance', 'instances', 'storage', 'store', 'bucket', 'primary', 'replica', 'node', 'nodes', 'worker', 'workers',
  'backend', 'frontend', 'client', 'proxy', 'gateway', 'index', 'search', 'stream', 'streams', 'topic', 'topics', 'repo',
]);

/** Logo names that are also everyday words in labels; they never match automatically. */
const GENERIC = new Set([
  'go', 'next', 'node', 'box', 'x', 'access', 'make', 'delta', 'buffer', 'arch', 'alpine', 'amp', 'spring', 'mint', 'circle',
  'square', 'target', 'shell', 'signal', 'ghost', 'plane', 'zap', 'files', 'scan', 'pi', 'lens', 'radar', 'rocket', 'rss',
  'flower', 'wine', 'drone', 'nfc', 'eraser', 'mailbox', 'handshake', 'lighthouse', 'asterisk', 'stack', 'about', 'linear',
  'element', 'matrix', 'line', 'medium', 'meet', 'mercury', 'quantum', 'spectrum', 'chef', 'salt', 'turbo', 'boundary',
  'waypoint', 'venus', 'saturn', 'gatsby', 'meteor', 'ember', 'polymer', 'crystal', 'opera', 'brave', 'wise', 'kong', 'bun',
]);

/** Short service names that need no vendor word. */
const BARE_CLOUD: Record<string, string> = {
  s3: 'aws-s3', ec2: 'aws-ec2', sqs: 'aws-sqs', sns: 'aws-sns', dynamodb: 'aws-dynamodb', cloudfront: 'aws-cloudfront',
  cloudwatch: 'aws-cloudwatch', route53: 'aws-route53', eks: 'aws-eks', ecs: 'aws-ecs', ecr: 'aws-ecr', rds: 'aws-rds',
  lambda: 'aws-lambda', aurora: 'aws-aurora', redshift: 'aws-redshift', kinesis: 'aws-kinesis', athena: 'aws-athena',
  sagemaker: 'aws-sagemaker', bedrock: 'aws-bedrock', cognito: 'aws-cognito', fargate: 'aws-fargate', elasticache: 'aws-elasticache',
  bigquery: 'gcp-bigquery', bigtable: 'gcp-bigtable', pubsub: 'gcp-pubsub', gke: 'gcp-gke', spanner: 'gcp-spanner', firestore: 'gcp-firestore',
  aks: 'azure-aks', cosmosdb: 'azure-cosmos-db',
};

/** Vendor words at the start of a label → index prefix and how many words they take. */
function vendorOf(words: string[]): { prefix: string; take: number } | undefined {
  const [a, b] = words;
  if (a === 'aws' || a === 'amazon') return { prefix: 'aws', take: a === 'amazon' && b === 'aws' ? 2 : 1 };
  if (a === 'gcp') return { prefix: 'gcp', take: 1 };
  if (a === 'google' && b === 'cloud') return { prefix: 'gcp', take: 2 };
  if (a === 'azure') return { prefix: 'azure', take: 1 };
  if (a === 'microsoft' && b === 'azure') return { prefix: 'azure', take: 2 };
  return undefined;
}

/** Label → lower-case words. "Node.js" keeps one word (`nodejs`); "Cloud SQL" gives two. */
export function labelWords(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/\.(js|io|net)\b/g, '$1')
    .split(/[^a-z0-9+]+/)
    .filter(Boolean);
}

/** A name in the index whose icon is a logo or a cloud service (not a generic Lucide glyph). */
function productIcon(name: string): string | undefined {
  const r = resolveName(name);
  return r && r.set !== 'lucide' ? name : undefined;
}

/** The icon name to draw for a node label, or undefined. */
export function autoIconFor(label: string): string | undefined {
  if (!iconNamesLoaded()) return undefined;
  const words = labelWords(label);
  if (words.length === 0 || words.length > 6) return undefined;

  const vendor = vendorOf(words);
  if (vendor) {
    const rest = words.slice(vendor.take);
    for (let n = Math.min(rest.length, 5); n >= 1; n--) {
      const head = rest.slice(0, n);
      // Google Cloud product names often keep "Cloud" or "Google" (gcp-cloud-sql, gcp-google-kubernetes-engine).
      const extra = vendor.prefix === 'gcp' ? [`gcp-cloud-${head.join('-')}`, `gcp-google-${head.join('-')}`] : [];
      for (const name of [`${vendor.prefix}-${head.join('-')}`, `${vendor.prefix}-${head.join('')}`, ...extra]) {
        if (productIcon(name)) return name;
      }
    }
    return undefined;
  }

  // Product name (1–3 words), then only role words.
  for (let n = Math.min(words.length, 3); n >= 1; n--) {
    if (!words.slice(n).every((w) => ROLE.has(w))) continue;
    const head = words.slice(0, n);
    for (const key of new Set([head.join('-'), head.join('')])) {
      if (BARE_CLOUD[key]) return productIcon(BARE_CLOUD[key]!);
      if (GENERIC.has(key) || ROLE.has(key)) continue;
      const hit = productIcon(key);
      if (hit && resolveName(key)!.set === 'simple') return hit;
    }
  }
  return undefined;
}

/** The automatic icon of a graph node: none when it has `icon:`, when `autoIcons off`, or when nothing matches. */
export function nodeAutoIcon(d: Pick<DiagramBase, 'styles'>, node: Pick<GraphNode, 'attrs' | 'label'>): string | undefined {
  if (node.attrs.icon !== undefined || d.styles.autoIcons === 'off') return undefined;
  return autoIconFor(node.label);
}

/** Every `icon:` value in a parsed diagram plus the automatic icons of its graph nodes. */
export function diagramIconNames(d: Diagram): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const attrs = o.attrs as Record<string, unknown> | undefined;
    if (attrs && typeof attrs.icon === 'string') out.add(attrs.icon);
    if (typeof o.icon === 'string') out.add(o.icon);
    if (o.kind === 'node' && d.type !== 'sequence' && d.type !== 'erd') {
      const auto = nodeAutoIcon(d, o as unknown as GraphNode);
      if (auto) out.add(auto);
    }
    for (const [k, x] of Object.entries(o)) if (k !== 'span' && x && typeof x === 'object') walk(x);
  };
  walk(d);
  return out;
}

/** Load the name index and the artwork of every icon a diagram draws. Layout awaits this before measuring. */
export async function prepareIcons(d: Diagram): Promise<void> {
  await loadIconNames();
  await loadIcons(diagramIconNames(d));
}
