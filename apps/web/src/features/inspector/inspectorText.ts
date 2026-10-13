

export function noteOf(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.note === 'string' ? metadata.note : undefined;
}
