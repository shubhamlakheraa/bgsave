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

/**
 * Restore the page's scroll position from a captured RestoreState.
 *
 * Strategy (in order):
 *  1. If `scrollY` is present, try it. If the effective position lands
 *     within SCROLL_TOLERANCE_PX, we're done.
 *  2. Otherwise, if `anchorText` is present, search for it in the DOM and
 *     scroll the containing element into view.
 *  3. If neither yields a result, return 'failed' — the caller has enough
 *     signal to report partial restore in the UI, but the tab is still
 *     usable at scroll position 0.
 *
 * Returns 'noop' when the RestoreState carries no information at all
 * (both fields absent) so an empty restore doesn't look like a failure.
 */
export function applyState(
  doc: Document,
  win: Window,
  state: RestoreState,
): ApplyMethod {
  const hasScroll = typeof state.scrollY === 'number';
  const hasAnchor = typeof state.anchorText === 'string' && state.anchorText.length > 0;
  if (!hasScroll && !hasAnchor) return 'noop';

  if (hasScroll) {
    win.scrollTo({ top: state.scrollY!, left: 0, behavior: 'auto' });
    // Verify against the actual position; a shorter page silently clamps
    // to its own scrollHeight and we want to catch that.
    const delta = Math.abs(win.scrollY - state.scrollY!);
    if (delta <= SCROLL_TOLERANCE_PX) return 'scrollY';
  }

  if (hasAnchor) {
    const el = findAnchorElement(doc, state.anchorText!);
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'auto' });
      return 'anchor';
    }
  }

  return 'failed';
}
