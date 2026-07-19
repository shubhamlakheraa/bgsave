import { describe, it, expect, beforeEach } from 'vitest';
import { appendTabToWorkspace } from './append';
import { ProfileStore } from '../shared/storage';
import { HighlightStore } from '../shared/highlightStore';
import { MemoryKVStore } from '../shared/kvStore';
import { SCHEMA_VERSION } from '../shared/constants';
import type { Profile } from '../shared/types';
import type { FramesEnumerator, TabMessenger } from './freeze';
import type { TabLike } from './capture';

const NOW = 1_700_000_000_000;

function makeMessenger(overrides: Partial<TabMessenger> = {}): TabMessenger {
  return {
    requestState: async () => null,
    applyState: async () => null,
    ...overrides,
  };
}

function makeFrames(overrides: Partial<FramesEnumerator> = {}): FramesEnumerator {
  return { getFrames: async () => [], ...overrides };
}

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Auth',
    schemaVersion: SCHEMA_VERSION,
    createdAt: 1,
    updatedAt: 1,
    windows: [
      {
        focused: true,
        tabs: [
          {
            url: 'https://existing.com',
            title: 'Existing',
            pinned: false,
            groupId: -1,
            index: 0,
            restricted: false,
            capturedAt: 1,
          },
        ],
      },
    ],
    ...over,
  };
}

let store: ProfileStore;
let highlights: HighlightStore;

beforeEach(async () => {
  const kv = new MemoryKVStore();
  store = new ProfileStore(kv);
  highlights = new HighlightStore(new MemoryKVStore());
  await store.saveProfile(makeProfile());
});

describe('appendTabToWorkspace', () => {
  it('appends a new tab with live-captured state to the focused window', async () => {
    const tab: TabLike = {
      id: 10,
      url: 'https://new.com',
      title: 'New',
      index: 999,
      windowId: 5,
    };
    const messenger = makeMessenger({
      requestState: async () => ({ scrollY: 400, anchorText: 'substantive-anchor-text' }),
    });
    const outcome = await appendTabToWorkspace(
      { store, messenger, highlights, frames: makeFrames(), now: () => NOW },
      { profileId: 'p1', tab },
    );
    expect(outcome.kind).toBe('appended');
    if (outcome.kind !== 'appended') throw new Error('unreachable');
    expect(outcome.tabCount).toBe(2);
    expect(outcome.tabsWithState).toBe(1); // new tab has real scrollY, existing one doesn't

    const saved = await store.getProfile('p1');
    const tabs = saved!.windows[0].tabs;
    expect(tabs).toHaveLength(2);
    // New tab appended at the end with index = position within the window.
    expect(tabs[1]).toMatchObject({
      url: 'https://new.com',
      title: 'New',
      index: 1,
      scrollY: 400,
      anchorText: 'substantive-anchor-text',
    });
  });

  it('rejects a URL that is already in the workspace (fragment-insensitive)', async () => {
    const tab: TabLike = {
      id: 10,
      url: 'https://existing.com#some-section',
      title: 'Same page, deeper link',
      index: 999,
    };
    const outcome = await appendTabToWorkspace(
      { store, messenger: makeMessenger(), highlights, frames: makeFrames(), now: () => NOW },
      { profileId: 'p1', tab },
    );
    expect(outcome.kind).toBe('duplicate');
    const saved = await store.getProfile('p1');
    expect(saved!.windows[0].tabs).toHaveLength(1);
  });

  it('returns not_found when the profile is missing', async () => {
    const outcome = await appendTabToWorkspace(
      { store, messenger: makeMessenger(), highlights, frames: makeFrames(), now: () => NOW },
      { profileId: 'nope', tab: { url: 'https://a.com', index: 0 } },
    );
    expect(outcome.kind).toBe('not_found');
  });

  it('appends restricted URLs with metadata only (no messenger call)', async () => {
    let called = false;
    const messenger = makeMessenger({
      requestState: async () => {
        called = true;
        return { scrollY: 100, anchorText: 'x' };
      },
    });
    const tab: TabLike = {
      id: 10,
      url: 'chrome://settings',
      title: 'Settings',
      index: 999,
    };
    const outcome = await appendTabToWorkspace(
      { store, messenger, highlights, frames: makeFrames(), now: () => NOW },
      { profileId: 'p1', tab },
    );
    expect(outcome.kind).toBe('appended');
    expect(called).toBe(false);
    const saved = await store.getProfile('p1');
    const added = saved!.windows[0].tabs[1];
    expect(added.restricted).toBe(true);
    expect(added.scrollY).toBeUndefined();
    expect(added.anchorText).toBeUndefined();
  });

  it('still appends when the content script times out (state = null)', async () => {
    const messenger = makeMessenger({ requestState: async () => null });
    const outcome = await appendTabToWorkspace(
      { store, messenger, highlights, frames: makeFrames(), now: () => NOW },
      {
        profileId: 'p1',
        tab: { id: 10, url: 'https://slow.com', title: 'Slow', index: 999 },
      },
    );
    expect(outcome.kind).toBe('appended');
    const saved = await store.getProfile('p1');
    const added = saved!.windows[0].tabs[1];
    // Metadata still landed even though state is missing.
    expect(added.url).toBe('https://slow.com');
    expect(added.scrollY).toBeUndefined();
  });

  it('captures iframe state per non-top frame when the tab has iframes', async () => {
    const messenger = makeMessenger({
      requestState: async (_tabId, frameId) => {
        if (frameId === undefined) return { scrollY: 100, anchorText: 'top-substantive' };
        if (frameId === 42) return { scrollY: 500, anchorText: 'iframe-substantive' };
        return null;
      },
    });
    const frames = makeFrames({
      getFrames: async () => [
        { frameId: 0, url: 'https://parent.com' },
        { frameId: 42, url: 'https://embed.com/frame' },
      ],
    });
    const outcome = await appendTabToWorkspace(
      { store, messenger, highlights, frames, now: () => NOW },
      {
        profileId: 'p1',
        tab: { id: 10, url: 'https://parent.com', title: 'Parent', index: 999 },
      },
    );
    expect(outcome.kind).toBe('appended');
    const saved = await store.getProfile('p1');
    const added = saved!.windows[0].tabs[1];
    expect(added.frames).toEqual([
      { url: 'https://embed.com/frame', scrollY: 500, anchorText: 'iframe-substantive' },
    ]);
  });

  it('bumps updatedAt on the profile so downstream refreshes fire', async () => {
    const original = await store.getProfile('p1');
    const originalUpdated = original!.updatedAt;
    await new Promise((r) => setTimeout(r, 3));
    await appendTabToWorkspace(
      {
        store,
        messenger: makeMessenger(),
        highlights,
        frames: makeFrames(),
        now: () => Date.now(),
      },
      { profileId: 'p1', tab: { id: 10, url: 'https://new.com', index: 999 } },
    );
    const after = await store.getProfile('p1');
    expect(after!.updatedAt).toBeGreaterThan(originalUpdated);
  });
});
