import { describe, it, expect, beforeEach } from 'vitest';
import {
  restoreWorkspace,
  type RestoreDeps,
  type TabCreator,
  type TabLoadWaiter,
} from './restore';
import type { FramesEnumerator, TabMessenger } from './freeze';
import { ProfileStore } from '../shared/storage';
import { HighlightStore } from '../shared/highlightStore';
import { MemoryKVStore } from '../shared/kvStore';
import { SCHEMA_VERSION } from '../shared/constants';
import type { Profile, SavedTab } from '../shared/types';

const NOW = 1_700_000_000_000;

function tab(over: Partial<SavedTab> = {}): SavedTab {
  return {
    url: 'https://example.com',
    title: 'Example',
    pinned: false,
    groupId: -1,
    index: 0,
    restricted: false,
    capturedAt: NOW,
    ...over,
  };
}

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Test',
    schemaVersion: SCHEMA_VERSION,
    createdAt: NOW,
    updatedAt: NOW,
    windows: [{ focused: true, tabs: [tab()] }],
    ...over,
  };
}

interface RecordedCreator extends TabCreator {
  calls: {
    createWindow: Array<{ urls: string[]; focused: boolean }>;
    setPinned: Array<{ tabId: number; pinned: boolean }>;
    focusWindow: number[];
  };
}

function makeCreator(nextWindowId = 100): RecordedCreator {
  let wid = nextWindowId;
  let tid = 1000;
  const calls: RecordedCreator['calls'] = {
    createWindow: [],
    setPinned: [],
    focusWindow: [],
  };
  return {
    calls,
    async createWindow(urls, focused) {
      calls.createWindow.push({ urls, focused });
      const windowId = wid++;
      const tabIds = urls.map(() => tid++);
      return { windowId, tabIds };
    },
    async setPinned(tabId, pinned) {
      calls.setPinned.push({ tabId, pinned });
    },
    async focusWindow(windowId) {
      calls.focusWindow.push(windowId);
    },
  };
}

function makeWaiter(overrides: Partial<TabLoadWaiter> = {}): TabLoadWaiter {
  return { waitForLoad: async () => true, ...overrides };
}

function makeMessenger(overrides: Partial<TabMessenger> = {}): TabMessenger {
  return {
    requestState: async () => null,
    applyState: async () => ({ method: 'scrollY' }),
    ...overrides,
  };
}

function makeDeps(
  store: ProfileStore,
  highlights: HighlightStore,
  creator: TabCreator,
  waiter: TabLoadWaiter,
  messenger: TabMessenger,
  frames?: FramesEnumerator,
): RestoreDeps {
  return { store, highlights, creator, waiter, messenger, frames };
}

let store: ProfileStore;
let highlights: HighlightStore;
let kv: MemoryKVStore;

beforeEach(async () => {
  kv = new MemoryKVStore();
  store = new ProfileStore(kv);
  highlights = new HighlightStore(kv);
});

describe('restoreWorkspace — happy paths', () => {
  it('creates a single window with tabs in captured index order', async () => {
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [
              tab({ url: 'https://c.com', index: 2 }),
              tab({ url: 'https://a.com', index: 0 }),
              tab({ url: 'https://b.com', index: 1 }),
            ],
          },
        ],
      }),
    );
    const creator = makeCreator();
    const summary = await restoreWorkspace(
      makeDeps(store, highlights, creator, makeWaiter(), makeMessenger()),
      { id: 'p1' },
    );
    expect(creator.calls.createWindow).toHaveLength(1);
    expect(creator.calls.createWindow[0].urls).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);
    expect(summary.windowsCreated).toBe(1);
    expect(summary.tabsCreated).toBe(3);
  });

  it('creates multiple windows for a multi-window profile', async () => {
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          { focused: false, tabs: [tab({ url: 'https://w1.com' })] },
          { focused: true, tabs: [tab({ url: 'https://w2.com' })] },
        ],
      }),
    );
    const creator = makeCreator();
    await restoreWorkspace(
      makeDeps(store, highlights, creator, makeWaiter(), makeMessenger()),
      { id: 'p1' },
    );
    expect(creator.calls.createWindow).toHaveLength(2);
  });

  it('focuses the window that was focused at capture time', async () => {
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          { focused: false, tabs: [tab({ url: 'https://w1.com' })] },
          { focused: true, tabs: [tab({ url: 'https://w2.com' })] },
        ],
      }),
    );
    const creator = makeCreator(500);
    await restoreWorkspace(
      makeDeps(store, highlights, creator, makeWaiter(), makeMessenger()),
      { id: 'p1' },
    );
    // Second window in the loop gets id 501; that's the one marked focused.
    expect(creator.calls.focusWindow).toEqual([501]);
  });

  it('creates windows with focused=false to avoid focus flicker', async () => {
    await store.saveProfile(makeProfile({ id: 'p1' }));
    const creator = makeCreator();
    await restoreWorkspace(
      makeDeps(store, highlights, creator, makeWaiter(), makeMessenger()),
      { id: 'p1' },
    );
    for (const call of creator.calls.createWindow) {
      expect(call.focused).toBe(false);
    }
  });

  it('restores pinned state per tab', async () => {
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [
              tab({ url: 'https://free.com', pinned: false }),
              tab({ url: 'https://pinned.com', pinned: true, index: 1 }),
            ],
          },
        ],
      }),
    );
    const creator = makeCreator();
    await restoreWorkspace(
      makeDeps(store, highlights, creator, makeWaiter(), makeMessenger()),
      { id: 'p1' },
    );
    // First created tabId is 1000, second is 1001. Only 1001 was pinned.
    expect(creator.calls.setPinned).toEqual([{ tabId: 1001, pinned: true }]);
  });
});

describe('restoreWorkspace — highlights', () => {
  it('merges profile highlights into HighlightStore before creating tabs', async () => {
    let createCalls = 0;
    let highlightCountAtCreate = -1;
    const creator = makeCreator();
    // Snoop: check store contents at the moment createWindow is invoked to
    // prove highlights land before content-script initHighlights would run.
    const wrappedCreate = creator.createWindow.bind(creator);
    creator.createWindow = async (urls, focused) => {
      createCalls++;
      const hs = await highlights.getHighlights('https://has-highlights.com');
      highlightCountAtCreate = hs.length;
      return wrappedCreate(urls, focused);
    };

    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [
              tab({
                url: 'https://has-highlights.com',
                highlights: [
                  { text: 'a', anchor: 'x' },
                  { text: 'b', anchor: 'y' },
                ],
              }),
            ],
          },
        ],
      }),
    );

    await restoreWorkspace(
      makeDeps(store, highlights, creator, makeWaiter(), makeMessenger()),
      { id: 'p1' },
    );
    expect(createCalls).toBe(1);
    expect(highlightCountAtCreate).toBe(2);
  });

  it('does not clobber pre-existing user highlights (add is idempotent)', async () => {
    // User already has one of the two highlights the profile carries.
    await highlights.addHighlight('https://has-highlights.com', {
      text: 'a',
      anchor: 'x',
    });
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [
              tab({
                url: 'https://has-highlights.com',
                highlights: [
                  { text: 'a', anchor: 'x' },
                  { text: 'b', anchor: 'y' },
                ],
              }),
            ],
          },
        ],
      }),
    );
    await restoreWorkspace(
      makeDeps(store, highlights, makeCreator(), makeWaiter(), makeMessenger()),
      { id: 'p1' },
    );
    const hs = await highlights.getHighlights('https://has-highlights.com');
    // Union, not duplicates: dedup by (text, anchor).
    expect(hs).toHaveLength(2);
  });
});

describe('restoreWorkspace — apply state', () => {
  it('waits for load and sends APPLY_STATE per non-restricted tab with cognitive state', async () => {
    const applyCalls: number[] = [];
    const waiterCalls: number[] = [];
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [
              tab({ url: 'https://a.com', scrollY: 100, anchorText: 'top' }),
              tab({ url: 'https://b.com', anchorText: 'header', index: 1 }),
            ],
          },
        ],
      }),
    );
    const waiter: TabLoadWaiter = {
      waitForLoad: async (tabId) => {
        waiterCalls.push(tabId);
        return true;
      },
    };
    const messenger = makeMessenger({
      applyState: async (tabId) => {
        applyCalls.push(tabId);
        return { method: 'scrollY' };
      },
    });
    const summary = await restoreWorkspace(
      makeDeps(store, highlights, makeCreator(), waiter, messenger),
      { id: 'p1' },
    );
    expect(waiterCalls.sort()).toEqual([1000, 1001]);
    expect(applyCalls.sort()).toEqual([1000, 1001]);
    expect(summary.tabsWithState).toBe(2);
    expect(summary.tabsFailed).toBe(0);
  });

  it('skips APPLY_STATE for restricted tabs', async () => {
    const applyCalls: number[] = [];
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [
              tab({
                url: 'chrome://settings',
                restricted: true,
                scrollY: 0,
              }),
              tab({
                url: 'https://real.com',
                scrollY: 300,
                index: 1,
              }),
            ],
          },
        ],
      }),
    );
    const messenger = makeMessenger({
      applyState: async (tabId) => {
        applyCalls.push(tabId);
        return { method: 'scrollY' };
      },
    });
    await restoreWorkspace(
      makeDeps(store, highlights, makeCreator(), makeWaiter(), messenger),
      { id: 'p1' },
    );
    // Only the non-restricted tab (second, tabId 1001) was messaged.
    expect(applyCalls).toEqual([1001]);
  });

  it('skips APPLY_STATE for tabs without any cognitive state', async () => {
    const applyCalls: number[] = [];
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [tab({ url: 'https://plain.com' })],
          },
        ],
      }),
    );
    const messenger = makeMessenger({
      applyState: async (tabId) => {
        applyCalls.push(tabId);
        return { method: 'scrollY' };
      },
    });
    const summary = await restoreWorkspace(
      makeDeps(store, highlights, makeCreator(), makeWaiter(), messenger),
      { id: 'p1' },
    );
    expect(applyCalls).toEqual([]);
    expect(summary.tabsWithState).toBe(0);
    expect(summary.tabsFailed).toBe(0);
  });

  it('counts tabs that time out on load as failed', async () => {
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [tab({ url: 'https://slow.com', scrollY: 100 })],
          },
        ],
      }),
    );
    const summary = await restoreWorkspace(
      makeDeps(
        store,
        highlights,
        makeCreator(),
        { waitForLoad: async () => false },
        makeMessenger(),
      ),
      { id: 'p1' },
    );
    expect(summary.tabsFailed).toBe(1);
    expect(summary.tabsWithState).toBe(0);
  });

  it("counts tabs where applyState returned 'failed'", async () => {
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [tab({ url: 'https://drifted.com', scrollY: 100 })],
          },
        ],
      }),
    );
    const summary = await restoreWorkspace(
      makeDeps(
        store,
        highlights,
        makeCreator(),
        makeWaiter(),
        makeMessenger({ applyState: async () => ({ method: 'failed' }) }),
      ),
      { id: 'p1' },
    );
    expect(summary.tabsFailed).toBe(1);
  });
});

describe('restoreWorkspace — iframes', () => {
  it('applies iframe state via frameId matched by URL', async () => {
    const applied: Array<{ frameId: number | undefined; scrollY?: number }> = [];
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [
              tab({
                url: 'https://parent.com',
                scrollY: 100,
                anchorText: 'top-anchor-with-enough-length',
                frames: [
                  {
                    url: 'https://embed.com/frame',
                    scrollY: 500,
                    anchorText: 'iframe-anchor-with-enough-length',
                  },
                ],
              }),
            ],
          },
        ],
      }),
    );
    const messenger = makeMessenger({
      applyState: async (_tabId, state, frameId) => {
        applied.push({ frameId, scrollY: state.scrollY });
        return { method: 'scrollY' };
      },
    });
    const frames: FramesEnumerator = {
      getFrames: async () => [
        { frameId: 0, url: 'https://parent.com' },
        { frameId: 77, url: 'https://embed.com/frame' },
      ],
    };
    await restoreWorkspace(
      makeDeps(store, highlights, makeCreator(), makeWaiter(), messenger, frames),
      { id: 'p1' },
    );
    // Both the top frame (undefined frameId) and the iframe (77) were applied.
    expect(applied.some((a) => a.frameId === undefined && a.scrollY === 100)).toBe(true);
    expect(applied.some((a) => a.frameId === 77 && a.scrollY === 500)).toBe(true);
  });

  it("skips iframe state when the URL doesn't match any live frame", async () => {
    const applied: Array<{ frameId: number | undefined }> = [];
    await store.saveProfile(
      makeProfile({
        id: 'p1',
        windows: [
          {
            focused: true,
            tabs: [
              tab({
                url: 'https://parent.com',
                scrollY: 100,
                anchorText: 'top-anchor-with-enough-length',
                frames: [
                  {
                    url: 'https://gone.com/frame',
                    scrollY: 500,
                    anchorText: 'iframe-anchor',
                  },
                ],
              }),
            ],
          },
        ],
      }),
    );
    const messenger = makeMessenger({
      applyState: async (_tabId, _state, frameId) => {
        applied.push({ frameId });
        return { method: 'scrollY' };
      },
    });
    const frames: FramesEnumerator = {
      getFrames: async () => [
        { frameId: 0, url: 'https://parent.com' },
        { frameId: 77, url: 'https://still-here.com/frame' }, // different URL
      ],
    };
    await restoreWorkspace(
      makeDeps(store, highlights, makeCreator(), makeWaiter(), messenger, frames),
      { id: 'p1' },
    );
    // Only the top frame apply happened; iframe was skipped.
    expect(applied.filter((a) => a.frameId !== undefined)).toEqual([]);
  });
});

describe('restoreWorkspace — errors', () => {
  it('throws when the profile id does not exist', async () => {
    await expect(
      restoreWorkspace(
        makeDeps(store, highlights, makeCreator(), makeWaiter(), makeMessenger()),
        { id: 'nope' },
      ),
    ).rejects.toThrow(/not found/i);
  });
});
