import { LIMITS } from '../shared/constants';
import type { Highlight } from '../shared/types';

// CSS class + data attributes used to mark and re-identify highlight spans
// in the DOM. Kept as module constants so tests and orchestrator agree on
// the exact strings.
export const HIGHLIGHT_CLASS = 'bgsave-highlight';
export const DATA_TEXT = 'data-bgsave-text';
export const DATA_ANCHOR = 'data-bgsave-anchor';

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

/**
 * Walk `root`'s text nodes in document order and build a flat concatenated
 * string plus a segment map so we can convert an index in the flat string
 * back to `(text node, offset)`. This is the primitive that lets us treat
 * the page's textual content as one contiguous string when searching for a
 * highlight, ignoring how the DOM happens to be split into text nodes.
 *
 * Skips text inside our own highlight spans so re-application over an
 * already-highlighted page still finds unhighlighted occurrences.
 */
export function buildTextMap(root: Node): { text: string; segments: TextSegment[] } {
  const segments: TextSegment[] = [];
  let text = '';
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Reject text nodes inside <script>, <style>, etc. — they're not
      // user-visible text and would poison the anchor search.
      const parent = node.parentElement;
      if (parent && /^(SCRIPT|STYLE|NOSCRIPT)$/i.test(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    const t = (node as Text).data;
    if (t.length > 0) {
      segments.push({ node: node as Text, start: text.length, end: text.length + t.length });
      text += t;
    }
    node = walker.nextNode();
  }
  return { text, segments };
}

function findSegmentContainingIndex(
  segments: TextSegment[],
  index: number,
  isEnd = false,
): TextSegment | null {
  for (const s of segments) {
    // For a start index, we want [start, end); for an end index (exclusive
    // boundary), we want (start, end]. Otherwise a boundary sitting exactly
    // on `end` snaps to the wrong segment.
    if (isEnd ? index > s.start && index <= s.end : index >= s.start && index < s.end) {
      return s;
    }
  }
  return null;
}

/**
 * Given `text` (the highlighted string) and `anchor` (the text that
 * appeared right before it at capture time), find a matching range in
 * `root`. Uses `anchor + text` as the search string — anchor
 * disambiguates when the same phrase appears multiple times on the page.
 * Returns null when no unambiguous match exists.
 */
export function findHighlightRange(
  root: Node,
  highlight: Highlight,
): Range | null {
  const map = buildTextMap(root);
  const needle = highlight.anchor + highlight.text;
  const idx = map.text.indexOf(needle);
  if (idx < 0) return null;
  const start = idx + highlight.anchor.length;
  const end = start + highlight.text.length;

  const startSeg = findSegmentContainingIndex(map.segments, start);
  const endSeg = findSegmentContainingIndex(map.segments, end, true);
  if (!startSeg || !endSeg) return null;

  const doc = root.ownerDocument ?? (root as Document);
  const range = doc.createRange();
  range.setStart(startSeg.node, start - startSeg.start);
  range.setEnd(endSeg.node, end - endSeg.start);
  return range;
}

/**
 * Given a live range (from the user's current text selection), extract
 * `{ text, anchor }` — the string that will be persisted and later used
 * to re-find the same span.
 *
 * `anchor` is up to LIMITS.HIGHLIGHT_ANCHOR_MAX characters of the text
 * that appears in the DOM immediately before the range's start. It's how
 * we tell apart two occurrences of the same phrase on the page.
 *
 * Returns null if the range's start container isn't a text node we can
 * locate in the tree (unusual, e.g. selection inside an <input>).
 */
export function extractHighlight(range: Range, root: Node): Highlight | null {
  if (range.collapsed) return null;
  const map = buildTextMap(root);
  const startNode = range.startContainer;
  if (startNode.nodeType !== Node.TEXT_NODE) return null;
  const startSeg = map.segments.find((s) => s.node === startNode);
  if (!startSeg) return null;
  const startIdx = startSeg.start + range.startOffset;
  const anchor = map.text.slice(
    Math.max(0, startIdx - LIMITS.HIGHLIGHT_ANCHOR_MAX),
    startIdx,
  );
  const text = range.toString().slice(0, LIMITS.HIGHLIGHT_TEXT_MAX);
  if (text.length === 0) return null;
  return { text, anchor };
}

/**
 * Wrap the given range in one or more highlight spans and stamp the
 * highlight's identity onto each span so removal can find it later.
 *
 * A range may cross element boundaries (e.g. a selection spanning two
 * paragraphs), so we walk the text nodes it intersects and wrap each
 * partially-covered slice separately. The returned array is the ordered
 * list of spans that together represent the highlight.
 */
export function wrapRange(range: Range, highlight: Highlight): HTMLSpanElement[] {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return [];

  // Snapshot the text nodes we need to touch BEFORE mutating the DOM;
  // mutating during traversal invalidates the TreeWalker.
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    if (range.intersectsNode(n)) textNodes.push(n as Text);
    n = walker.nextNode();
  }
  // commonAncestorContainer may itself be a text node — TreeWalker won't
  // yield the root in that case, so handle it explicitly.
  if (
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE &&
    textNodes.length === 0
  ) {
    textNodes.push(range.commonAncestorContainer as Text);
  }

  const spans: HTMLSpanElement[] = [];
  for (const tn of textNodes) {
    let start = 0;
    let end = tn.data.length;
    if (tn === range.startContainer) start = range.startOffset;
    if (tn === range.endContainer) end = range.endOffset;
    if (start >= end) continue;

    const before = tn.data.slice(0, start);
    const middle = tn.data.slice(start, end);
    const after = tn.data.slice(end);

    const span = doc.createElement('span');
    span.className = HIGHLIGHT_CLASS;
    span.setAttribute(DATA_TEXT, highlight.text);
    span.setAttribute(DATA_ANCHOR, highlight.anchor);
    span.textContent = middle;

    const parent = tn.parentNode;
    if (!parent) continue;
    if (before) parent.insertBefore(doc.createTextNode(before), tn);
    parent.insertBefore(span, tn);
    if (after) parent.insertBefore(doc.createTextNode(after), tn);
    parent.removeChild(tn);
    spans.push(span);
  }
  return spans;
}

/**
 * Undo a highlight: replace each span with its own text content and merge
 * adjacent text nodes so the DOM ends up equivalent to its pre-highlight
 * shape.
 */
export function unwrapSpan(span: HTMLElement): void {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  if ('normalize' in parent) (parent as Element).normalize();
}

/**
 * Read a highlight span's stored identity back off its data-* attributes.
 * Returns null if the attributes are missing — those spans aren't ours,
 * or were tampered with, and we shouldn't touch them.
 */
export function readSpanHighlight(el: Element): Highlight | null {
  const text = el.getAttribute(DATA_TEXT);
  const anchor = el.getAttribute(DATA_ANCHOR);
  if (text === null || anchor === null) return null;
  return { text, anchor };
}

/**
 * Find every highlight span that intersects the range. A single logical
 * highlight may be spread across multiple spans (multi-node range), so
 * the caller usually wants to group them by (text, anchor) before removal.
 */
export function findHighlightSpansInRange(range: Range): HTMLElement[] {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return [];
  const root = range.commonAncestorContainer;
  const scope = root.nodeType === Node.ELEMENT_NODE ? (root as Element) : root.parentElement;
  if (!scope) return [];
  const candidates = scope.getElementsByClassName(HIGHLIGHT_CLASS);
  const result: HTMLElement[] = [];
  for (const el of Array.from(candidates)) {
    if (range.intersectsNode(el)) result.push(el as HTMLElement);
  }
  return result;
}
