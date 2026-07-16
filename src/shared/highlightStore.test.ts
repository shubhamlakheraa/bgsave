import { describe, it, expect, beforeEach } from 'vitest';
import { HighlightStore, normalizeHighlightUrl } from './highlightStore';
import { MemoryKVStore } from './kvStore';
import { LIMITS, highlightsKey } from './constants';

let kv: MemoryKVStore;
let store: HighlightStore;

beforeEach(() => {
  kv = new MemoryKVStore();
  store = new HighlightStore(kv);
});

describe('normalizeHighlightUrl', () => {
  it('strips the fragment', () => {
    expect(normalizeHighlightUrl('https://example.com/doc#section-2')).toBe(
      'https://example.com/doc',
    );
  });

  it('keeps query params (they usually address different content)', () => {
    expect(normalizeHighlightUrl('https://example.com/doc?v=2#top')).toBe(
      'https://example.com/doc?v=2',
    );
  });

  it('falls back to the raw string for unparseable URLs', () => {
    expect(normalizeHighlightUrl('about:blank')).toBe('about:blank');
  });
});

describe('HighlightStore.get/add', () => {
  it('returns [] for a URL with no highlights', async () => {
    expect(await store.getHighlights('https://a.com')).toEqual([]);
  });

  it('add + get roundtrips a highlight', async () => {
    await store.addHighlight('https://a.com', { text: 'hello', anchor: 'greeting: ' });
    expect(await store.getHighlights('https://a.com')).toEqual([
      { text: 'hello', anchor: 'greeting: ' },
    ]);
  });

  it('URLs that differ only by fragment share the same highlights', async () => {
    await store.addHighlight('https://a.com/doc#section-1', {
      text: 'x',
      anchor: 'y',
    });
    const other = await store.getHighlights('https://a.com/doc#section-9');
    expect(other).toEqual([{ text: 'x', anchor: 'y' }]);
  });

  it('URLs that differ by query param do NOT share highlights', async () => {
    await store.addHighlight('https://a.com/doc?v=1', { text: 'x', anchor: 'y' });
    expect(await store.getHighlights('https://a.com/doc?v=2')).toEqual([]);
  });

  it('is a no-op when adding an already-present highlight', async () => {
    const h = { text: 'dup', anchor: 'a' };
    expect(await store.addHighlight('https://a.com', h)).toBe(true);
    expect(await store.addHighlight('https://a.com', h)).toBe(false);
    expect(await store.getHighlights('https://a.com')).toHaveLength(1);
  });

  it('refuses to add past the per-URL cap', async () => {
    for (let i = 0; i < LIMITS.HIGHLIGHTS_PER_URL_MAX; i++) {
      const ok = await store.addHighlight('https://a.com', {
        text: `t-${i}`,
        anchor: `a-${i}`,
      });
      expect(ok).toBe(true);
    }
    const oneMore = await store.addHighlight('https://a.com', {
      text: 'over',
      anchor: 'over',
    });
    expect(oneMore).toBe(false);
  });
});

describe('HighlightStore.remove', () => {
  it('removes a highlight by exact match', async () => {
    await store.addHighlight('https://a.com', { text: 'a', anchor: '1' });
    await store.addHighlight('https://a.com', { text: 'b', anchor: '2' });
    const removed = await store.removeHighlight('https://a.com', { text: 'a', anchor: '1' });
    expect(removed).toBe(true);
    expect(await store.getHighlights('https://a.com')).toEqual([{ text: 'b', anchor: '2' }]);
  });

  it('returns false when nothing matched', async () => {
    await store.addHighlight('https://a.com', { text: 'a', anchor: '1' });
    const removed = await store.removeHighlight('https://a.com', {
      text: 'nope',
      anchor: 'nope',
    });
    expect(removed).toBe(false);
  });

  it('wipes the storage key when the last highlight is removed', async () => {
    await store.addHighlight('https://a.com', { text: 'only', anchor: 'x' });
    await store.removeHighlight('https://a.com', { text: 'only', anchor: 'x' });
    const raw = await kv.get(highlightsKey('https://a.com'));
    expect(raw).toBeNull();
  });
});

describe('HighlightStore corruption safety', () => {
  it('treats a malformed stored value as empty', async () => {
    kv._setRaw(highlightsKey('https://a.com'), JSON.stringify({ not: 'an array' }));
    expect(await store.getHighlights('https://a.com')).toEqual([]);
  });

  it('filters out array entries missing required fields', async () => {
    kv._setRaw(
      highlightsKey('https://a.com'),
      JSON.stringify([{ text: 'ok', anchor: 'ok' }, { text: 'missing anchor' }]),
    );
    // isHighlightArray requires every element to be well-formed, so a mixed
    // array is treated as fully invalid — safer than returning a partial view.
    expect(await store.getHighlights('https://a.com')).toEqual([]);
  });
});
