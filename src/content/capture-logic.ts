import { LIMITS } from '../shared/constants';
import type { CapturedState } from '../shared/contentMessaging';

// Selector for text-carrying elements we'll consider as anchor candidates.
// Kept intentionally narrow: headings, paragraphs, list items. Buttons/nav
// aren't useful anchors — they either move or repeat identically across
// pages, both of which make restore misfire.
const ANCHOR_CANDIDATES = 'h1, h2, h3, h4, h5, h6, p, li, article, section';

// Whitespace-normalise text so anchors survive minor DOM re-formatting
// (extra newlines, tabs from indentation) between capture and restore.
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Pick the topmost visible text element as an anchor. "Visible" means the
 * element has a rect that intersects the viewport and has non-empty
 * normalised text. Restore uses this string to re-find its scroll target
 * even if the page's height has drifted.
 *
 * Returns `''` (not null) when nothing qualifies — callers treat empty as
 * "no anchor available" and simply skip scroll restore for that tab.
 */
export function computeAnchor(doc: Document, win: Window): string {
  const viewportHeight = win.innerHeight;
  if (viewportHeight === 0) return '';

  const candidates = doc.querySelectorAll<HTMLElement>(ANCHOR_CANDIDATES);
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    // Element must have some vertical intersection with the viewport.
    if (rect.bottom <= 0 || rect.top >= viewportHeight) continue;
    // Prefer elements whose top edge is within the viewport (not scrolled
    // past); skip huge <section> wrappers whose top is way above the fold.
    if (rect.top < -rect.height) continue;

    const text = normalize(el.textContent ?? '');
    if (text.length === 0) continue;
    return text.slice(0, LIMITS.ANCHOR_TEXT_MAX);
  }

  return '';
}

export function computeScroll(win: Window): number {
  // scrollY is fractional in some browsers on zoomed viewports. Floor for
  // stability on restore comparison.
  return Math.floor(win.scrollY);
}

export function captureState(doc: Document, win: Window): CapturedState {
  return {
    scrollY: computeScroll(win),
    anchorText: computeAnchor(doc, win),
  };
}
