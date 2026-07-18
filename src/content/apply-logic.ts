import type { ApplyMethod, RestoreState } from '../shared/contentMessaging';
import { buildTextMap } from './highlight-logic';

// How far the actual scroll position is allowed to differ from the target
// before we treat the direct-scrollY attempt as a failure and fall back to
// anchor search. Sticky headers, cookie banners, and layout-shift artifacts
// commonly nudge the effective position by tens of pixels — anything under
// ~50px still lands the user on the same paragraph.
const SCROLL_TOLERANCE_PX = 50;

/**
 * Find the element whose text content contains `anchorText` and return it,
 * so a caller can scrollIntoView on it. The search is done against the
 * flattened document text (same primitive we use for highlight lookup) so
 * anchors that span text-node boundaries still resolve.
 *
 * Returns the *closest ancestor Element* of the matching text region so
 * scrollIntoView actually has something with a rect to work with — raw
 * text nodes aren't scrollable targets.
 */
export function findAnchorElement(doc: Document, anchorText: string): Element | null {
  if (!anchorText) return null;
  const root = doc.body;
  if (!root) return null;
  const map = buildTextMap(root);
  const idx = map.text.indexOf(anchorText);
  if (idx < 0) return null;

  const seg = map.segments.find((s) => idx >= s.start && idx < s.end);
  if (!seg) return null;

  // Walk from the text node up to the nearest Element.
  let node: Node | null = seg.node;
  while (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentNode;
  }
  return node as Element | null;
}

// Anchor must be at least this many characters to be trusted at restore
// time. Short strings ("Web", "Menu") often occur many times on a page,
// so scrolling to the first match would land the user in the wrong spot.
// Kept in sync with computeAnchor's ANCHOR_MIN_LEN — separate constant
// because they may drift apart if the schema evolves.
const ANCHOR_MIN_APPLY_LEN = 20;

// scrollY values at or below this are treated as "no window scroll" —
// SPAs with internal scroll containers commonly report window.scrollY = 0
// no matter how far the user scrolled. Applying scrollTo(0) is a no-op
// and shouldn't count as success.
const SCROLL_MIN_TARGET_PX = 100;

/**
 * Restore the page's scroll position from a captured RestoreState.
 *
 * Strategy:
 *  1. If scrollY is substantial, apply it eagerly. This has two benefits:
 *     it approximates the reading position for pages where anchor may
 *     not resolve, and it *triggers virtualization* on long pages — many
 *     SPAs only render sections near the current scroll position, so the
 *     anchor text isn't in the DOM until we scroll to roughly the right
 *     place first.
 *  2. If anchor is present and long enough, resolve and `scrollIntoView`
 *     on the containing element. This refines the position — after
 *     step 1's approximation, virtualization has usually rendered the
 *     anchor into the DOM, so `scrollIntoView` lands us precisely.
 *  3. Report the best result — 'anchor' if step 2 landed, 'scrollY' if
 *     step 1 landed within tolerance, otherwise 'failed' so the caller
 *     retries as late-rendered content arrives.
 *
 * Returns 'noop' when the RestoreState carries no information at all.
 */
export function applyState(
  doc: Document,
  win: Window,
  state: RestoreState,
): ApplyMethod {
  const scrollTarget = typeof state.scrollY === 'number' ? state.scrollY : null;
  const hasSubstantialScroll = scrollTarget !== null && scrollTarget >= SCROLL_MIN_TARGET_PX;
  const anchor = state.anchorText;
  const hasAnchor = typeof anchor === 'string' && anchor.length >= ANCHOR_MIN_APPLY_LEN;
  if (scrollTarget === null && !hasAnchor) return 'noop';

  // Step 1: rough scroll first so virtualization can render nearby content.
  if (hasSubstantialScroll) {
    win.scrollTo({ top: scrollTarget!, left: 0, behavior: 'auto' });
  }

  // Step 2: anchor refines and wins if it resolves.
  if (hasAnchor) {
    const el = findAnchorElement(doc, anchor!);
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'auto' });
      return 'anchor';
    }
  }

  // Step 3: report scrollY if it landed close enough (page tall enough).
  if (hasSubstantialScroll) {
    const delta = Math.abs(win.scrollY - scrollTarget!);
    if (delta <= SCROLL_TOLERANCE_PX) return 'scrollY';
  }

  return 'failed';
}
