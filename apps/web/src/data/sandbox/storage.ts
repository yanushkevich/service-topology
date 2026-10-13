/**
 * Browser storage for the local sandbox (ADR-031). Every access is guarded: in a private window,
 * with blocked site data, or in tests, it falls back to memory and says so (`persistent: false`).
 */
export interface SandboxStorage {
  readonly persistent: boolean;
  read<T>(key: string): T | null;
  write(key: string, value: unknown): void;
  remove(key: string): void;
}

export function createSandboxStorage(storage: Storage | null = safeLocalStorage()): SandboxStorage {
  const memory = new Map<string, string>();
  let persistent = storage !== null;
  const raw = (key: string): string | null => {
    if (persistent && storage) {
      try {
        return storage.getItem(key);
      } catch {
        persistent = false;
      }
    }
    return memory.get(key) ?? null;
  };
  return {
    get persistent() {
      return persistent;
    },
    read<T>(key: string): T | null {
      const text = raw(key);
      if (text === null) return null;
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
    write(key, value) {
      const text = JSON.stringify(value);
      memory.set(key, text);
      if (persistent && storage) {
        try {
          storage.setItem(key, text);
        } catch {
          persistent = false;
        }
      }
    },
    remove(key) {
      memory.delete(key);
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing to clean up when storage is unavailable.
      }
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** A short, stable fingerprint of a value: the sandbox resets when the built-in data it extends changes. */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}
