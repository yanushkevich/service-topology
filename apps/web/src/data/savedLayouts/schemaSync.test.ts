import { describe, expect, it } from 'vitest';
import { ENTITY_GROUPS } from '../../domain/registry';
import { HEALTH_STATUSES, PROVIDERS } from '../../domain/types';
import { LAYOUT_MODES } from '../../state/uiStore';
import { SAVED_LAYOUT_SCHEMA_VERSION } from './savedLayout';

// The published JSON Schema must describe exactly what the runtime validator accepts.
const schemaFiles = import.meta.glob<string>('../../../../../docs/schemas/saved-layout.v1.schema.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const schema = JSON.parse(Object.values(schemaFiles)[0] ?? '{}');
const view = schema.properties.view.properties;
const filters = view.filters.properties;

describe('docs/schemas/saved-layout.v1.schema.json', () => {
  it('matches the code constants', () => {
    expect(schema.properties.schemaVersion.const).toBe(SAVED_LAYOUT_SCHEMA_VERSION);
    expect(view.layoutMode.enum).toEqual([...LAYOUT_MODES]);
    expect(filters.providers.items.enum).toEqual([...PROVIDERS]);
    expect(filters.health.items.enum).toEqual([...HEALTH_STATUSES]);
    expect(filters.groups.items.enum).toEqual([...ENTITY_GROUPS]);
  });
});
