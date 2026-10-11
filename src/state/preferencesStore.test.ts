import { beforeEach, describe, expect, it } from 'vitest';
import { isMotionReduced } from './motion';
import {
  createLocalPreferencesRepository,
  createMemoryPreferencesRepository,
  DEFAULT_PREFERENCES,
  effectiveTheme,
  parsePreferences,
  PREFERENCES_STORAGE_KEY,
  setPreferencesRepository,
  usePreferencesStore,
} from './preferencesStore';

class FakeStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('preferences', () => {
  beforeEach(() => setPreferencesRepository(createMemoryPreferencesRepository()));

  it('falls back field by field for invalid stored values', () => {
    expect(parsePreferences({ theme: 'purple', motion: 'reduce', galaxyTraffic: 'yes' })).toEqual({ ...DEFAULT_PREFERENCES, motion: 'reduce' });
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it('persists to local storage and survives corrupted data', () => {
    const storage = new FakeStorage();
    const repo = createLocalPreferencesRepository(storage);
    repo.save({ ...DEFAULT_PREFERENCES, theme: 'light' });
    expect(JSON.parse(storage.getItem(PREFERENCES_STORAGE_KEY)!)).toMatchObject({ theme: 'light', schemaVersion: 1 });
    expect(createLocalPreferencesRepository(storage).load().theme).toBe('light');
    storage.setItem(PREFERENCES_STORAGE_KEY, '{nope');
    expect(createLocalPreferencesRepository(storage).load()).toEqual(DEFAULT_PREFERENCES);
  });

  it('updates and resets through the store', () => {
    usePreferencesStore.getState().update({ defaultView: '3d', simulationSpeed: 'fast' });
    expect(usePreferencesStore.getState().preferences).toMatchObject({ defaultView: '3d', simulationSpeed: 'fast' });
    usePreferencesStore.getState().reset();
    expect(usePreferencesStore.getState().preferences).toEqual(DEFAULT_PREFERENCES);
  });

  it('resolves the effective theme and the motion override', () => {
    expect(effectiveTheme('light')).toBe('light');
    expect(effectiveTheme('system')).toBe('dark'); // jsdom matchMedia reports no light preference
    expect(isMotionReduced()).toBe(false);
    usePreferencesStore.getState().update({ motion: 'reduce' });
    expect(isMotionReduced()).toBe(true);
  });
});
