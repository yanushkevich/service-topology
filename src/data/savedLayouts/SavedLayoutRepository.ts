import { parseSavedLayout, type SavedLayout } from './savedLayout';

/** Persistence boundary for saved layouts; a future API adapter implements the same interface. */
export interface SavedLayoutRepository {
  /** Newest first. */
  list(): Promise<SavedLayout[]>;
  /** Insert or replace by ID. */
  save(layout: SavedLayout): Promise<void>;
  remove(id: string): Promise<void>;
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const SAVED_LAYOUTS_STORAGE_KEY = 'service-topology:saved-layouts:v1';

const newestFirst = (a: SavedLayout, b: SavedLayout) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

export function createInMemorySavedLayoutRepository(initial: SavedLayout[] = []): SavedLayoutRepository {
  let layouts = structuredClone(initial);
  return {
    async list() {
      return structuredClone(layouts).sort(newestFirst);
    },
    async save(layout) {
      const valid = parseSavedLayout(structuredClone(layout));
      if (!valid) throw new Error('Refusing to save an invalid layout');
      layouts = [...layouts.filter((l) => l.id !== valid.id), valid];
    },
    async remove(id) {
      layouts = layouts.filter((l) => l.id !== id);
    },
  };
}

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Browser-local persistence. Invalid or corrupted entries are skipped, not thrown. If storage is
 * unavailable (private mode, blocked site data) layouts are kept in memory for the session.
 */
export function createLocalSavedLayoutRepository(storage: KeyValueStorage | null = browserStorage()): SavedLayoutRepository {
  const memory = createInMemorySavedLayoutRepository();
  if (!storage) return memory;

  const read = (): SavedLayout[] => {
    try {
      const raw = storage.getItem(SAVED_LAYOUTS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(parseSavedLayout).filter((l): l is SavedLayout => l !== null) : [];
    } catch {
      return [];
    }
  };
  const write = (layouts: SavedLayout[]) => storage.setItem(SAVED_LAYOUTS_STORAGE_KEY, JSON.stringify(layouts));

  return {
    async list() {
      return read().sort(newestFirst);
    },
    async save(layout) {
      const valid = parseSavedLayout(JSON.parse(JSON.stringify(layout)));
      if (!valid) throw new Error('Refusing to save an invalid layout');
      write([...read().filter((l) => l.id !== valid.id), valid]);
    },
    async remove(id) {
      write(read().filter((l) => l.id !== id));
    },
  };
}
