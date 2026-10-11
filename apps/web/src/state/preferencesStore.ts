import { create } from 'zustand';

/**
 * Local, per-browser preferences (PRODUCT_SPEC Revision 5 §K.4). Never canonical or shared state:
 * they choose defaults and presentation only. Persisted behind PreferencesRepository.
 */

export const PREFERENCES_SCHEMA_VERSION = 1;
export type ThemePreference = 'system' | 'dark' | 'light';
export type MotionPreference = 'system' | 'reduce';

export interface Preferences {
  schemaVersion: typeof PREFERENCES_SCHEMA_VERSION;
  theme: ThemePreference;
  motion: MotionPreference;
  /** View the Service Map opens in when the URL does not say. */
  defaultView: '2d' | '3d';
  galaxyLabels: 'minimal' | 'auto' | 'all';
  galaxyTraffic: boolean;
  simulationSpeed: 'slow' | 'normal' | 'fast';
}

export const DEFAULT_PREFERENCES: Preferences = {
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
  theme: 'system',
  motion: 'system',
  defaultView: '2d',
  galaxyLabels: 'auto',
  galaxyTraffic: true,
  simulationSpeed: 'normal',
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** Tolerant parse: unknown or invalid fields fall back to defaults individually. */
export function parsePreferences(value: unknown): Preferences {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES;
  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    theme: oneOf(v.theme, ['system', 'dark', 'light'], d.theme),
    motion: oneOf(v.motion, ['system', 'reduce'], d.motion),
    defaultView: oneOf(v.defaultView, ['2d', '3d'], d.defaultView),
    galaxyLabels: oneOf(v.galaxyLabels, ['minimal', 'auto', 'all'], d.galaxyLabels),
    galaxyTraffic: typeof v.galaxyTraffic === 'boolean' ? v.galaxyTraffic : d.galaxyTraffic,
    simulationSpeed: oneOf(v.simulationSpeed, ['slow', 'normal', 'fast'], d.simulationSpeed),
  };
}

export interface PreferencesRepository {
  load(): Preferences;
  save(preferences: Preferences): void;
}

export const PREFERENCES_STORAGE_KEY = 'service-topology:preferences:v1';

export function createMemoryPreferencesRepository(initial: Preferences = DEFAULT_PREFERENCES): PreferencesRepository {
  let stored = initial;
  return {
    load: () => stored,
    save: (preferences) => {
      stored = preferences;
    },
  };
}

export function createLocalPreferencesRepository(storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage()): PreferencesRepository {
  let memory = DEFAULT_PREFERENCES;
  return {
    load() {
      if (!storage) return memory;
      try {
        const raw = storage.getItem(PREFERENCES_STORAGE_KEY);
        return raw ? parsePreferences(JSON.parse(raw)) : DEFAULT_PREFERENCES;
      } catch {
        return DEFAULT_PREFERENCES;
      }
    },
    save(preferences) {
      memory = preferences;
      try {
        storage?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
      } catch {
        // Storage can be full or blocked; preferences still apply for this session.
      }
    },
  };
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let repository: PreferencesRepository = createLocalPreferencesRepository();

interface PreferencesStore {
  preferences: Preferences;
  update: (patch: Partial<Omit<Preferences, 'schemaVersion'>>) => void;
  reset: () => void;
}

export const usePreferencesStore = create<PreferencesStore>()((set, get) => ({
  preferences: repository.load(),
  update: (patch) => {
    const preferences = parsePreferences({ ...get().preferences, ...patch });
    repository.save(preferences);
    set({ preferences });
  },
  reset: () => {
    repository.save(DEFAULT_PREFERENCES);
    set({ preferences: DEFAULT_PREFERENCES });
  },
}));

/** Swap the repository (tests) and reload from it. */
export function setPreferencesRepository(next: PreferencesRepository) {
  repository = next;
  usePreferencesStore.setState({ preferences: next.load() });
}

/** Theme actually shown: an explicit choice, or the OS preference for "system". */
export function effectiveTheme(preference: ThemePreference): 'dark' | 'light' {
  if (preference !== 'system') return preference;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
