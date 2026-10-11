const TIMESTAMP = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** Compact UTC timestamp ("11 Oct, 08:45 UTC"); an em dash when absent or invalid. */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : `${TIMESTAMP.format(date)} UTC`;
}

export function formatNumber(value: number | undefined, unit: string): string {
  if (value === undefined) return '—';
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString('en-US')}${unit}`;
}

/** Metadata values are untyped; render primitives directly and anything else as JSON. */
export function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
