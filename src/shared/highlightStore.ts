import { LIMITS, highlightsKey } from './constants';
import type { KVStore } from './kvStore';
import type { Highlight } from './types';

// Strip the fragment so `#section-2` scrolling doesn't split highlights across
// virtual URLs, but keep query parameters — they usually address genuinely
// different content (e.g., `?doc=v2`). Falls back to the raw string for
// non-parseable URLs (e.g., `about:blank`).
export function normalizeHighlightUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function sameHighlight(a: Highlight, b: Highlight): boolean {
  return a.text === b.text && a.anchor === b.anchor;
}

function isHighlightArray(value: unknown): value is Highlight[] {
  return (
    Array.isArray(value) &&
    value.every(
      (h) =>
        typeof h === 'object' &&
        h !== null &&
        typeof (h as Highlight).text === 'string' &&
        typeof (h as Highlight).anchor === 'string',
    )
  );
}

/**
 * Persistent per-URL highlight store. Highlights are keyed by the normalized
 * URL, not by profile — a highlight follows the page across freeze/restore
 * cycles and shows up any time the user opens the same URL, whether or not
 * a workspace is being restored.
 *
 * Freeze reads from here to bundle highlights into a Profile so exports and
 * restores across devices stay self-contained.
 */
export class HighlightStore {
  constructor(private readonly kv: KVStore) {}

  async getHighlights(url: string): Promise<Highlight[]> {
    const raw = await this.kv.get(highlightsKey(normalizeHighlightUrl(url)));
    return isHighlightArray(raw) ? raw : [];
  }

  /**
   * Add a highlight. Returns `false` if the exact same text+anchor is
   * already present (no-op) or if the per-URL cap has been reached.
   */
  async addHighlight(url: string, h: Highlight): Promise<boolean> {
    const current = await this.getHighlights(url);
    if (current.some((x) => sameHighlight(x, h))) return false;
    if (current.length >= LIMITS.HIGHLIGHTS_PER_URL_MAX) return false;
    await this.kv.set(highlightsKey(normalizeHighlightUrl(url)), [...current, h]);
    return true;
  }

  /**
   * Remove a highlight by exact match. Returns `true` iff a highlight was
   * removed. Removing the last highlight for a URL wipes the storage key
   * entirely so we don't leave `[]` sentinels behind.
   */
  async removeHighlight(url: string, h: Highlight): Promise<boolean> {
    const key = highlightsKey(normalizeHighlightUrl(url));
    const current = await this.getHighlights(url);
    const next = current.filter((x) => !sameHighlight(x, h));
    if (next.length === current.length) return false;
    if (next.length === 0) await this.kv.remove(key);
    else await this.kv.set(key, next);
    return true;
  }
}
