import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS } from '../../domain/registry';
import { parseSavedLayout, type SavedLayout } from './savedLayout';
import {
  createInMemorySavedLayoutRepository,
  createLocalSavedLayoutRepository,
  SAVED_LAYOUTS_STORAGE_KEY,
} from './SavedLayoutRepository';

const layout = (overrides: Partial<SavedLayout> = {}): SavedLayout => ({
  schemaVersion: 1,
  id: 'layout-1',
  name: 'On-call view',
  createdAt: '2026-10-11T09:00:00.000Z',
  view: { environmentId: 'production', layoutMode: 'infrastructure', filters: EMPTY_FILTERS, collapsedGroupIds: ['kafka-events-prod'] },
  positions: { 'order-service.production': { x: 10, y: 20 } },
  ...overrides,
});

class FakeStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('parseSavedLayout', () => {
  it('accepts a valid v1 layout and survives a JSON round trip', () => {
    expect(parseSavedLayout(JSON.parse(JSON.stringify(layout())))).toEqual(layout());
  });

  it.each([
    ['wrong version', { ...layout(), schemaVersion: 2 }],
    ['empty name', layout({ name: '  ' })],
    ['bad date', layout({ createdAt: 'yesterday' })],
    ['unknown layout mode', { ...layout(), view: { ...layout().view, layoutMode: 'radial' } }],
    ['unknown provider filter', { ...layout(), view: { ...layout().view, filters: { ...EMPTY_FILTERS, providers: ['mars'] } } }],
    ['non-numeric position', layout({ positions: { a: { x: '1', y: 2 } as never } })],
    ['infinite position', layout({ positions: { a: { x: Infinity, y: 2 } } })],
    ['renderer object in positions', layout({ positions: { a: { x: 1, y: 2, measured: { width: 1 } } as never } })],
    ['not an object', 'layout'],
  ])('rejects %s', (_name, value) => {
    expect(parseSavedLayout(value)).toBeNull();
  });
});

describe('saved layout repositories', () => {
  it('in-memory: saves, replaces by ID, lists newest first, removes', async () => {
    const repo = createInMemorySavedLayoutRepository();
    await repo.save(layout());
    await repo.save(layout({ id: 'layout-2', createdAt: '2026-10-11T10:00:00.000Z' }));
    await repo.save(layout({ name: 'Renamed' }));
    expect((await repo.list()).map((l) => [l.id, l.name])).toEqual([
      ['layout-2', 'On-call view'],
      ['layout-1', 'Renamed'],
    ]);
    await repo.remove('layout-2');
    expect((await repo.list()).map((l) => l.id)).toEqual(['layout-1']);
  });

  it('refuses to save invalid layouts', async () => {
    await expect(createInMemorySavedLayoutRepository().save(layout({ name: '' }))).rejects.toThrow();
  });

  it('local storage: persists plain JSON and reads it back', async () => {
    const storage = new FakeStorage();
    await createLocalSavedLayoutRepository(storage).save(layout());
    const raw = JSON.parse(storage.getItem(SAVED_LAYOUTS_STORAGE_KEY) ?? '[]');
    expect(raw).toEqual([layout()]);
    expect(await createLocalSavedLayoutRepository(storage).list()).toEqual([layout()]);
  });

  it('local storage: skips corrupted entries instead of failing', async () => {
    const storage = new FakeStorage();
    storage.setItem(SAVED_LAYOUTS_STORAGE_KEY, JSON.stringify([layout(), { junk: true }]));
    expect(await createLocalSavedLayoutRepository(storage).list()).toEqual([layout()]);
    storage.setItem(SAVED_LAYOUTS_STORAGE_KEY, '{not json');
    expect(await createLocalSavedLayoutRepository(storage).list()).toEqual([]);
  });

  it('falls back to memory when storage is unavailable', async () => {
    const repo = createLocalSavedLayoutRepository(null);
    await repo.save(layout());
    expect(await repo.list()).toHaveLength(1);
  });
});
