import { parse, stringify } from 'yaml';
import { validateBundle, type BundleIssue, type DataBundle } from './bundle';

/**
 * Bundle files (docs/DATA_BUNDLE.md §2–3): the same structure as JSON or YAML. YAML is read with
 * the YAML 1.2 core schema, so times and IDs stay strings and a JSON file is also valid YAML.
 */

export type BundleFormat = 'json' | 'yaml';

export function serializeBundle(bundle: DataBundle, format: BundleFormat): string {
  return format === 'json' ? `${JSON.stringify(bundle, null, 2)}\n` : stringify(bundle, { lineWidth: 0 });
}

export function formatOfFileName(name: string): BundleFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return null;
}

/** `service-topology-<source>-<yyyy-mm-dd>.<ext>`. */
export function bundleFileName(sourceLabel: string, exportedAt: string, format: BundleFormat): string {
  const source = sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'data';
  return `service-topology-${source}-${exportedAt.slice(0, 10)}.${format}`;
}

export type ReadResult = { ok: true; bundle: DataBundle } | { ok: false; issues: BundleIssue[] };

/** Parses and validates a file's text. Any issue blocks the import. */
export function readBundle(text: string, format: BundleFormat): ReadResult {
  let value: unknown;
  try {
    value = format === 'json' ? JSON.parse(text) : parse(text);
  } catch (error) {
    return { ok: false, issues: [{ code: 'bundle-unreadable', path: '', message: `The file is not valid ${format === 'json' ? 'JSON' : 'YAML'}: ${firstLine(error)}` }] };
  }
  let issues: BundleIssue[];
  try {
    issues = validateBundle(value);
  } catch (error) {
    // An entry with fields of the wrong type (a number where a list belongs, …) that the shape check let through.
    issues = [{ code: 'bundle-invalid-module', path: '', message: `The file’s entries do not have the expected fields: ${firstLine(error)}` }];
  }
  return issues.length ? { ok: false, issues } : { ok: true, bundle: value as DataBundle };
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
}
