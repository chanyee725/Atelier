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

/**
 * Node kinds named by a generic word (#935): a Lucide glyph and a pale palette colour, the way Eraser's examples
 * mark gateways, databases, caches and queues. The kind word is the label's last word ("API Gateway", "Orders DB",
 * "Session cache") or the whole label ("Client"); a label of more than four words is a sentence and gets none.
 * Only cloud-architecture diagrams use kinds (#948): flowchart nodes are steps ("Validate user", "Check cache",
 * "Is user admin?"), and their last word names what the step acts on, not what the node is.
 */
const KINDS: [words: string[], icon: string, color: string][] = [
  [['gateway', 'proxy', 'router', 'balancer', 'lb', 'cdn', 'ingress', 'firewall'], 'network', 'purple'],
  [['db', 'database', 'databases', 'store', 'storage', 'warehouse', 'table', 'bucket', 'replica'], 'database', 'blue'],
  [['cache'], 'zap', 'red'],
  [['queue', 'broker', 'topic', 'topics', 'stream', 'streams', 'bus', 'events'], 'inbox', 'orange'],
  [['service', 'services', 'api', 'server', 'servers', 'backend'], 'server', 'green'],
  [['worker', 'workers', 'job', 'jobs', 'scheduler', 'cron'], 'cpu', 'green'],
  [['client', 'clients', 'frontend', 'browser', 'web', 'ui', 'app', 'dashboard'], 'monitor', 'gray'],
  [['mobile', 'ios', 'android'], 'smartphone', 'gray'],
  [['user', 'users', 'customer', 'customers', 'admin'], 'user', 'gray'],
  [['auth', 'identity', 'login', 'sso', 'iam'], 'lock', 'indigo'],
  [['search', 'index'], 'search', 'indigo'],
  [['llm', 'model', 'agent', 'ai'], 'bot', 'purple'],
];
const KIND_OF = new Map(KINDS.flatMap(([words, icon, color]) => words.map((w) => [w, { icon, color }] as const)));

/** The kind of a node label: its Lucide glyph and pale colour, or undefined. */
export function kindOf(label: string): { icon: string; color: string } | undefined {
  const words = labelWords(label);
  if (words.length === 0 || words.length > 4) return undefined;
  return KIND_OF.get(words[words.length - 1]!);
}

type AutoDiagram = Pick<DiagramBase, 'styles'> & { type: Diagram['type'] };

/** The kind of a node in this diagram: cloud-architecture only (#948). */
const nodeKind = (d: AutoDiagram, label: string) => (d.type === 'cloud-architecture' ? kindOf(label) : undefined);

/**
 * The automatic icon of a graph node: none when it has `icon:` or `autoIcons off`; else a product logo or cloud
 * service (#734), else the glyph of its kind word in a cloud-architecture diagram (#935, #948).
 */
export function nodeAutoIcon(d: AutoDiagram, node: Pick<GraphNode, 'attrs' | 'label'>): string | undefined {
  if (node.attrs.icon !== undefined || d.styles.autoIcons === 'off') return undefined;
  return autoIconFor(node.label) ?? (iconNamesLoaded() ? nodeKind(d, node.label)?.icon : undefined);
}

/** The automatic pale colour of a graph node's kind: none with `color:`, `autoIcons off` or outside cloud-architecture (#935, #948). */
export function nodeAutoColor(d: AutoDiagram, node: Pick<GraphNode, 'attrs' | 'label'>): string | undefined {
  if (node.attrs.color !== undefined || d.styles.autoIcons === 'off') return undefined;
  return nodeKind(d, node.label)?.color;
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
