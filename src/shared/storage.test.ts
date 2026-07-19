import { describe, it, expect, beforeEach } from 'vitest';
import { ProfileStore } from './storage';
import { MemoryKVStore } from './kvStore';
import { SCHEMA_VERSION, STORAGE_KEYS, corruptedKey, profileKey } from './constants';
import type { Profile } from './types';

let kv: MemoryKVStore;
let store: ProfileStore;

beforeEach(() => {
  kv = new MemoryKVStore();
  store = new ProfileStore(kv);
});

const makeProfile = (over: Partial<Profile> = {}): Profile => ({
  id: over.id ?? crypto.randomUUID(),
  name: over.name ?? 'Auth-JWT',
  schemaVersion: SCHEMA_VERSION,
  createdAt: 0,
  updatedAt: 0,
  windows: [
    {
      focused: true,
      tabs: [
        {
          url: 'https://example.com',
          title: 'Example',
          pinned: false,
          groupId: -1,
          index: 0,
          restricted: false,
          capturedAt: Date.now(),
        },
      ],
    },
  ],
  ...over,
});

describe('ProfileStore CRUD', () => {
  it('starts with an empty index', async () => {
    expect(await store.listProfiles()).toEqual([]);
  });

  it('roundtrips a saved profile', async () => {
    const p = makeProfile({ name: 'Auth-JWT' });
    await store.saveProfile(p);

    const list = await store.listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: p.id, name: 'Auth-JWT', tabCount: 1 });

    const loaded = await store.getProfile(p.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Auth-JWT');
    expect(loaded!.updatedAt).toBeGreaterThan(0);
  });

  it('records tabsWithState in the index entry based on captured state', async () => {
    // Two tabs — one with real scroll, one with just metadata. The drift
    // count should be 1 (only the substantial-scroll tab counts).
    const p = makeProfile({
      name: 'Drift',
      windows: [
        {
          focused: true,
          tabs: [
            {
              url: 'https://a.com',
              title: 'A',
              pinned: false,
              groupId: -1,
              index: 0,
              restricted: false,
              capturedAt: 1,
              scrollY: 400,
            },
            {
              url: 'https://b.com',
              title: 'B',
              pinned: false,
              groupId: -1,
              index: 1,
              restricted: false,
              capturedAt: 1,
            },
          ],
        },
      ],
    });
    await store.saveProfile(p);
    const list = await store.listProfiles();
    expect(list[0].tabsWithState).toBe(1);
    expect(list[0].tabCount).toBe(2);
  });

  it('updates an existing profile in place', async () => {
    const p = makeProfile({ name: 'A' });
    await store.saveProfile(p);
    const first = await store.listProfiles();
    const firstUpdatedAt = first[0].updatedAt;

    await new Promise((r) => setTimeout(r, 5));
    await store.saveProfile({ ...p, name: 'A' });
    const second = await store.listProfiles();

    expect(second).toHaveLength(1);
    expect(second[0].updatedAt).toBeGreaterThan(firstUpdatedAt);
  });

  it('trims whitespace from the stored name', async () => {
    const p = makeProfile({ name: '  Padded  ' });
    await store.saveProfile(p);
    const loaded = await store.getProfile(p.id);
    expect(loaded!.name).toBe('Padded');
  });

  it('rejects duplicate names on save', async () => {
    await store.saveProfile(makeProfile({ id: 'a', name: 'Same' }));
    await expect(
      store.saveProfile(makeProfile({ id: 'b', name: 'Same' })),
    ).rejects.toThrow(/already exists/i);
  });

  it('allows saving with the same name after rename to that name (excludeId)', async () => {
    const p = makeProfile({ id: 'a', name: 'Foo' });
    await store.saveProfile(p);
    // Renaming to the same name should not trip the duplicate check.
    await expect(store.renameProfile('a', 'Foo')).resolves.toBeUndefined();
  });

  it('renames a profile', async () => {
    const p = makeProfile({ name: 'Before' });
    await store.saveProfile(p);
    await store.renameProfile(p.id, 'After');
    const loaded = await store.getProfile(p.id);
    expect(loaded!.name).toBe('After');
    const list = await store.listProfiles();
    expect(list[0].name).toBe('After');
  });

  it('rejects renaming to a name that collides with a different profile', async () => {
    await store.saveProfile(makeProfile({ id: 'a', name: 'Auth' }));
    await store.saveProfile(makeProfile({ id: 'b', name: 'Redis' }));
    await expect(store.renameProfile('b', 'Auth')).rejects.toThrow(/already exists/i);
  });

  it('deletes a profile and removes its index entry', async () => {
    const p = makeProfile();
    await store.saveProfile(p);
    await store.deleteProfile(p.id);
    expect(await store.listProfiles()).toEqual([]);
    expect(await store.getProfile(p.id)).toBeNull();
  });

  it('rejects unsupported schema versions on save', async () => {
    const p = makeProfile();
    await expect(
      store.saveProfile({ ...p, schemaVersion: 99 as never }),
    ).rejects.toThrow(/schema version/i);
  });
});

describe('ProfileStore quarantine on corruption', () => {
  it('quarantines a malformed profile blob and returns null', async () => {
    const goodId = 'g1';
    // First save a valid profile so the index has an entry pointing at goodId.
    await store.saveProfile(makeProfile({ id: goodId, name: 'Good' }));

    // Corrupt the profile blob directly (simulate mid-write crash / bad state).
    kv._setRaw(profileKey(goodId), JSON.stringify({ id: goodId, garbage: true }));

    const loaded = await store.getProfile(goodId);
    expect(loaded).toBeNull();

    // Corrupted value should be quarantined, not lost.
    const quarantined = await kv.get(corruptedKey(goodId));
    expect(quarantined).toEqual({ id: goodId, garbage: true });

    // Index should no longer reference the missing profile.
    const list = await store.listProfiles();
    expect(list.find((e) => e.id === goodId)).toBeUndefined();
  });

  it('quarantines a corrupt index and starts fresh', async () => {
    kv._setRaw(STORAGE_KEYS.PROFILE_INDEX, JSON.stringify('not-an-array'));
    const list = await store.listProfiles();
    expect(list).toEqual([]);
    const quarantined = await kv.get(corruptedKey('profileIndex'));
    expect(quarantined).toBe('not-an-array');
  });
});

describe('ProfileStore crash-safe ordering', () => {
  it('save writes blob before updating index', async () => {
    // We can't literally crash mid-write in vitest, but we can spy on the
    // KV set order. Wrap kv.set to record the sequence of keys touched.
    const seen: string[] = [];
    const originalSet = kv.set.bind(kv);
    kv.set = async (key, value) => {
      seen.push(key);
      await originalSet(key, value);
    };

    const p = makeProfile({ name: 'Ordered' });
    await store.saveProfile(p);

    // Blob key must appear before index key.
    const blobIdx = seen.indexOf(profileKey(p.id));
    const indexIdx = seen.indexOf(STORAGE_KEYS.PROFILE_INDEX);
    expect(blobIdx).toBeGreaterThanOrEqual(0);
    expect(indexIdx).toBeGreaterThanOrEqual(0);
    expect(blobIdx).toBeLessThan(indexIdx);
  });

  it('delete updates index before removing blob', async () => {
    const p = makeProfile();
    await store.saveProfile(p);

    const order: Array<{ op: 'set' | 'remove'; key: string }> = [];
    const originalSet = kv.set.bind(kv);
    const originalRemove = kv.remove.bind(kv);
    kv.set = async (key, value) => {
      order.push({ op: 'set', key });
      await originalSet(key, value);
    };
    kv.remove = async (key) => {
      order.push({ op: 'remove', key });
      await originalRemove(key);
    };

    await store.deleteProfile(p.id);

    const indexUpdate = order.findIndex(
      (o) => o.op === 'set' && o.key === STORAGE_KEYS.PROFILE_INDEX,
    );
    const blobRemoval = order.findIndex(
      (o) => o.op === 'remove' && o.key === profileKey(p.id),
    );
    expect(indexUpdate).toBeGreaterThanOrEqual(0);
    expect(blobRemoval).toBeGreaterThanOrEqual(0);
    expect(indexUpdate).toBeLessThan(blobRemoval);
  });
});
