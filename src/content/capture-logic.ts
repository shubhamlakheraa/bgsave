import { LIMITS } from '../shared/constants';
import type { CapturedState } from '../shared/contentMessaging';

// Anchor candidates now include structural div/span/main/etc. because most
// SPAs render text inside plain <div>s rather than semantic tags. We rely
// on the text-length filter below to reject bare wrappers and container
// divs whose text spans the whole page.
const ANCHOR_CANDIDATES =
  'h1, h2, h3, h4, h5, h6, p, li, article, section, main, blockquote, header, aside, nav, div, span';

// Anchor must be at least this many characters to be worth persisting.
// Anything shorter (e.g. "Web", "Menu") is too generic to disambiguate
// two occurrences of the same phrase on the page at restore time.
const ANCHOR_MIN_LEN = 20;

// Elements with more text than this are almost always page-sized wrappers
// (the SPA's app root, an <article> that contains the whole feed). Their
// text isn't a useful anchor because it re-matches from the top of the
// page on restore.
const ANCHOR_MAX_ELEMENT_TEXT = 1500;

// Whitespace-normalise text so anchors survive minor DOM re-formatting
// (extra newlines, tabs from indentation) between capture and restore.
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Tags whose text isn't a useful anchor (scripts, style, embedded content,
// media). If elementFromPoint or the tree walk hits one, we stop — the
// meaningful anchor is elsewhere on the page.
const NON_TEXT_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|IFRAME|SVG|CANVAS|VIDEO|IMG)$/i;

// Tags for site-navigation regions. Their text isn't scroll-relevant — the
// nav stays put while the user scrolls the main column — so anchoring on
// nav content lands the user right back where they started on restore.
const CHROME_TAGS = /^(NAV|ASIDE|HEADER|FOOTER)$/i;

// True if this element or any ancestor is inside a site-navigation region
// (semantic tag OR ARIA role). Used to skip anchor candidates that would
// point at the sidebar/topbar instead of the article/message.
function inSiteChrome(el: Element): boolean {
  let cur: Element | null = el;
  while (cur && cur !== cur.ownerDocument?.body) {
    if (CHROME_TAGS.test(cur.tagName)) return true;
    const role = cur.getAttribute('role');
    if (role && /(navigation|banner|contentinfo|complementary)/i.test(role)) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Pick the anchor by looking at the element under the *center* of the
 * viewport, a small distance below the top. That's the main content
 * column for practically every modern layout — pages with a left
 * sidebar (MDN, LeetCode, ChatGPT) or top nav (Neetcode) have their nav
 * pushed to the edges, and the center of the viewport is the article,
 * message, or problem statement the user is actually reading.
 *
 * We sample several vertical positions in case the first hits a sticky
 * header, banner, or ad — the deepest-first walk-up finds substantive
 * text as soon as one exists.
 *
 * Fallback: the older `querySelectorAll` scan for pages where
 * elementFromPoint returns nothing useful (very sparse layout, or the
 * top-center point sits over an image / SVG).
 *
 * Returns `''` when nothing qualifies — callers treat empty as
 * "no anchor available" and fall back to scrollY.
 */
export function computeAnchor(doc: Document, win: Window): string {
  const viewportHeight = win.innerHeight;
  const viewportWidth = win.innerWidth;
  if (viewportHeight === 0 || viewportWidth === 0) return '';

  const centerX = Math.max(1, Math.floor(viewportWidth / 2));
  // Try several vertical sample points below the top of the viewport.
  // Higher samples first so we prefer content closest to where the user
  // was reading, but lower samples exist for pages with tall headers.
  const samples = [
    Math.max(60, Math.floor(viewportHeight * 0.15)),
    Math.max(120, Math.floor(viewportHeight * 0.3)),
    Math.max(200, Math.floor(viewportHeight * 0.5)),
  ];

  for (const y of samples) {
    if (y >= viewportHeight) continue;
    let el = doc.elementFromPoint(centerX, y) as Element | null;
    while (el && el !== doc.body && el !== doc.documentElement) {
      if (NON_TEXT_TAGS.test(el.tagName)) break;
      // If we're inside a nav / sidebar region, don't return its text.
      // Skip to the next sample point — the main content is elsewhere in
      // the viewport (or, if the whole viewport is chrome, the fallback
      // scan will handle it with the same filter).
      if (inSiteChrome(el)) break;
      const text = normalize(el.textContent ?? '');
      if (text.length >= ANCHOR_MIN_LEN && text.length <= ANCHOR_MAX_ELEMENT_TEXT) {
        return text.slice(0, LIMITS.ANCHOR_TEXT_MAX);
      }
      // Overshot into a page-sized wrapper — stop climbing rather than
      // returning "the whole page's text".
      if (text.length > ANCHOR_MAX_ELEMENT_TEXT) break;
      el = el.parentElement;
    }
  }

  // Fallback for layouts where elementFromPoint sits over a decorative
  // element (image, SVG). Scan the semantic candidates in DOM order,
  // skipping anything inside site-navigation regions.
  const candidates = doc.querySelectorAll<HTMLElement>(ANCHOR_CANDIDATES);
  for (const el of candidates) {
    if (inSiteChrome(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= viewportHeight) continue;
    if (rect.top < -rect.height) continue;
    const text = normalize(el.textContent ?? '');
    if (text.length < ANCHOR_MIN_LEN) continue;
    if (text.length > ANCHOR_MAX_ELEMENT_TEXT) continue;
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
