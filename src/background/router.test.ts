import { describe, it, expect, beforeEach } from 'vitest';
import { makeMessageHandler } from './router';
import { WriteQueue } from './writeQueue';
import { ProfileStore } from '../shared/storage';
import { HighlightStore } from '../shared/highlightStore';
import { MemoryKVStore, type KVStore } from '../shared/kvStore';
import { SCHEMA_VERSION } from '../shared/constants';
import type { Profile } from '../shared/types';
import type { FramesEnumerator, TabFetcher, TabMessenger } from './freeze';
import type { TabCreator, TabLoadWaiter } from './restore';

let store: ProfileStore;
let queue: WriteQueue;
let handle: ReturnType<typeof makeMessageHandler>;
let idCounter: number;

const stubTabFetcher: TabFetcher = {
  queryCurrentWindow: async () => [
    { url: 'https://a.com', title: 'A', index: 0, windowId: 1 },
  ],
  getTabs: async (ids) =>
    ids.map((id) => ({
      url: `https://${id}.com`,
      title: `T${id}`,
      index: 0,
      windowId: 1,
    })),
  getLastFocusedWindowId: async () => 1,
};

const stubMessenger: TabMessenger = {
  requestState: async () => null,
  applyState: async () => null,
};

const stubCreator: TabCreator = {
  createWindow: async (urls) => ({
    windowId: 999,
    tabIds: urls.map((_, i) => 1000 + i),
  }),
  setPinned: async () => undefined,
  focusWindow: async () => undefined,
};

const stubWaiter: TabLoadWaiter = {
  waitForLoad: async () => true,
};

const stubFrames: FramesEnumerator = {
  getFrames: async () => [],
};

let kv: MemoryKVStore;

beforeEach(() => {
  kv = new MemoryKVStore();
  store = new ProfileStore(kv);
  queue = new WriteQueue();
  idCounter = 0;
  handle = makeMessageHandler({
    store,
    queue,
    tabs: stubTabFetcher,
    messenger: stubMessenger,
    highlights: new HighlightStore(kv),
    creator: stubCreator,
    waiter: stubWaiter,
    frames: stubFrames,
    now: () => 1_700_000_000_000,
    newId: () => `id-${++idCounter}`,
    bytesInUse: () => kv.getBytesInUse(),
  });
});

const buildProfile = (id: string, name: string): Profile => ({
  id,
  name,
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
});

describe('router — read messages', () => {
  it('PING returns PONG', async () => {
    const res = await handle({ type: 'PING' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.type).toBe('PONG');
      expect(typeof res.data.at).toBe('number');
    }
  });

  it('LIST_PROFILES returns [] when empty', async () => {
    const res = await handle({ type: 'LIST_PROFILES' });
    expect(res).toEqual({ ok: true, data: [] });
  });

  it('GET_PROFILE returns null for a missing id', async () => {
    const res = await handle({ type: 'GET_PROFILE', id: 'nope' });
    expect(res).toEqual({ ok: true, data: null });
  });

  it('VALIDATE_NAME rejects empty names', async () => {
    const res = await handle({ type: 'VALIDATE_NAME', name: '' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.ok).toBe(false);
  });
});

describe('router — write messages', () => {
  it('SAVE_PROFILE then LIST_PROFILES roundtrips', async () => {
    const p = buildProfile('a', 'Auth');
    const saveRes = await handle({ type: 'SAVE_PROFILE', profile: p });
    expect(saveRes.ok).toBe(true);

    const listRes = await handle({ type: 'LIST_PROFILES' });
    if (listRes.ok) {
      expect(listRes.data).toHaveLength(1);
      expect(listRes.data[0].name).toBe('Auth');
    }
  });

  it('SAVE_PROFILE returns an error envelope on duplicate names', async () => {
    await handle({ type: 'SAVE_PROFILE', profile: buildProfile('a', 'X') });
    const res = await handle({ type: 'SAVE_PROFILE', profile: buildProfile('b', 'X') });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already exists/i);
  });

  it('DELETE_PROFILE removes from list', async () => {
    await handle({ type: 'SAVE_PROFILE', profile: buildProfile('a', 'Auth') });
    await handle({ type: 'DELETE_PROFILE', id: 'a' });
    const list = await handle({ type: 'LIST_PROFILES' });
    if (list.ok) expect(list.data).toEqual([]);
  });

  it('RENAME_PROFILE updates the name', async () => {
    await handle({ type: 'SAVE_PROFILE', profile: buildProfile('a', 'Old') });
    await handle({ type: 'RENAME_PROFILE', id: 'a', newName: 'New' });
    const got = await handle({ type: 'GET_PROFILE', id: 'a' });
    if (got.ok) expect(got.data?.name).toBe('New');
  });
});

describe('router — FREEZE_WORKSPACE', () => {
  it('freezes the current window and returns the new index entry', async () => {
    const res = await handle({ type: 'FREEZE_WORKSPACE', name: 'Fresh' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({
        id: 'id-1',
        name: 'Fresh',
        tabCount: 1,
      });
    }

    const list = await handle({ type: 'LIST_PROFILES' });
    if (list.ok) expect(list.data).toHaveLength(1);
  });

  it('freezes with a subset of tabIds', async () => {
    const res = await handle({
      type: 'FREEZE_WORKSPACE',
      name: 'Picked',
      tabIds: [7, 8, 9],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.tabCount).toBe(3);
  });

  it('returns an error envelope on duplicate freeze names', async () => {
    await handle({ type: 'FREEZE_WORKSPACE', name: 'Dup' });
    const res = await handle({ type: 'FREEZE_WORKSPACE', name: 'Dup' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already exists/i);
  });
});

describe('router — queue serialization', () => {
  it('rapid-fire SAVE_PROFILE for different ids all land', async () => {
    const saves = Array.from({ length: 8 }, (_, i) =>
      handle({
        type: 'SAVE_PROFILE',
        profile: buildProfile(`id-${i}`, `Profile-${i}`),
      }),
    );
    const results = await Promise.all(saves);
    for (const r of results) expect(r.ok).toBe(true);

    const list = await handle({ type: 'LIST_PROFILES' });
    if (list.ok) {
      expect(list.data).toHaveLength(8);
      const names = list.data.map((e) => e.name).sort();
      expect(names).toEqual(
        Array.from({ length: 8 }, (_, i) => `Profile-${i}`).sort(),
      );
    }
  });
});

describe('router — quota', () => {
  it('GET_QUOTA_USAGE returns the current usage snapshot', async () => {
    const res = await handle({ type: 'GET_QUOTA_USAGE' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.bytesInUse).toBe(0);
      expect(res.data.quotaBytes).toBeGreaterThan(res.data.warnBytes);
      expect(res.data.percent).toBe(0);
    }
  });

  it('reflects bytes after a SAVE_PROFILE', async () => {
    await handle({ type: 'SAVE_PROFILE', profile: buildProfile('a', 'A') });
    const res = await handle({ type: 'GET_QUOTA_USAGE' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.bytesInUse).toBeGreaterThan(0);
  });

  it('maps QuotaExceededError to code=quota_exceeded', async () => {
    // Route SAVE_PROFILE through a KVStore whose set() throws Chrome's
    // native quota error — the router should surface it as a coded envelope.
    const inner = new MemoryKVStore();
    const failing: KVStore = {
      get: <T = unknown>(k: string) => inner.get<T>(k),
      set: async () => {
        throw new Error('QUOTA_BYTES quota exceeded');
      },
      remove: (k: string) => inner.remove(k),
      keys: () => inner.keys(),
      getBytesInUse: () => inner.getBytesInUse(),
    };
    const s = new ProfileStore(failing);
    const q = new WriteQueue();
    const h = makeMessageHandler({
      store: s,
      queue: q,
      tabs: stubTabFetcher,
      messenger: stubMessenger,
      highlights: new HighlightStore(failing),
      creator: stubCreator,
      waiter: stubWaiter,
      frames: stubFrames,
      now: () => 1_700_000_000_000,
      newId: () => 'id-x',
      bytesInUse: () => failing.getBytesInUse(),
    });
    const res = await h({ type: 'SAVE_PROFILE', profile: buildProfile('a', 'A') });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('quota_exceeded');
      expect(res.error).toMatch(/quota/i);
    }
  });
});
