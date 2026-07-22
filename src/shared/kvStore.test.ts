import { describe, it, expect } from 'vitest';
import { MemoryKVStore } from './kvStore';

describe('MemoryKVStore.getBytesInUse', () => {
  it('is 0 when empty', async () => {
    const kv = new MemoryKVStore();
    expect(await kv.getBytesInUse()).toBe(0);
  });

  it('sums key and JSON-encoded value byte lengths', async () => {
    const kv = new MemoryKVStore();
    await kv.set('k', 'v'); // "k" + JSON.stringify('v') = "k" + "\"v\"" = 1 + 3 = 4 bytes
    expect(await kv.getBytesInUse()).toBe(4);
  });

  it('counts multi-byte utf-8 characters correctly', async () => {
    const kv = new MemoryKVStore();
    // '¢' is 2 bytes in UTF-8, JSON-encoded as "¢" (3 UTF-8 bytes: quote, ¢, quote).
    await kv.set('a', '¢');
    // key "a" = 1 byte; JSON.stringify('¢') = "¢" — the surrounding quotes are
    // ASCII (2 bytes) and ¢ is 2 bytes → 4 bytes.
    expect(await kv.getBytesInUse()).toBe(5);
  });

  it('drops removed keys from the total', async () => {
    const kv = new MemoryKVStore();
    await kv.set('a', 1);
    const before = await kv.getBytesInUse();
    await kv.remove('a');
    const after = await kv.getBytesInUse();
    expect(after).toBeLessThan(before);
    expect(after).toBe(0);
  });
});
