// Abstracts the underlying key-value store so higher layers don't depend on
// chrome.storage.local directly. Enables in-memory testing and future adapters
// (e.g., cloud sync) without changing the profile logic.
export interface KVStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  // Returns all keys currently in the store. Used to scan for orphaned
  // `profile:*` blobs during recovery/cleanup.
  keys(): Promise<string[]>;
  // Bytes currently held by the store. Used by the quota guardrail so the
  // UI can warn before Chrome starts rejecting writes with QUOTA_BYTES.
  getBytesInUse(): Promise<number>;
}

// Production adapter — thin wrapper over chrome.storage.local.
// chrome.storage.local guarantees per-key atomicity, so callers can rely on
// writes landing whole (never a partial value).
export class ChromeKVStore implements KVStore {
  async get<T = unknown>(key: string): Promise<T | null> {
    const record = await chrome.storage.local.get(key);
    const value = record[key];
    return value === undefined ? null : (value as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }

  async keys(): Promise<string[]> {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all);
  }

  async getBytesInUse(): Promise<number> {
    // Passing null asks Chrome for total bytes across all keys.
    return chrome.storage.local.getBytesInUse(null);
  }
}

// Test adapter — a Map behind the same interface. Deep-clones on set/get so
// tests can't accidentally mutate stored objects by holding a reference.
export class MemoryKVStore implements KVStore {
  private data = new Map<string, string>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = this.data.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async getBytesInUse(): Promise<number> {
    // Mirror chrome.storage.local's accounting: sum of key + JSON-encoded
    // value bytes. Close enough for testing the guardrail without pulling
    // in a real Chrome runtime.
    let total = 0;
    for (const [key, value] of this.data) {
      total += byteLength(key) + byteLength(value);
    }
    return total;
  }

  // Test-only escape hatch: seed corrupted values directly (bypasses JSON
  // guarantees) to exercise quarantine paths.
  _setRaw(key: string, rawJson: string): void {
    this.data.set(key, rawJson);
  }
}

function byteLength(s: string): number {
  // TextEncoder is available in both jsdom and Node; avoids Blob allocations.
  return new TextEncoder().encode(s).length;
}
