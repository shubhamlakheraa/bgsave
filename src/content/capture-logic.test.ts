// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { captureState, computeAnchor, computeScroll } from './capture-logic';

// jsdom does layout math but doesn't actually paint. We fake
// getBoundingClientRect via a helper so we can position elements
// deterministically in "the viewport".
function setup(html: string) {
  document.body.innerHTML = html;
}

function fakeRect(el: HTMLElement, top: number, height: number) {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 100,
      width: 100,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  // jsdom doesn't implement elementFromPoint (needs real layout). Default
  // to a null-returning stub so tests exercise the querySelectorAll
  // fallback; individual tests can override to exercise the primary path.
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
});

describe('computeScroll', () => {
  it('returns floored window.scrollY', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 123.7 });
    expect(computeScroll(window)).toBe(123);
  });
});

describe('computeAnchor', () => {
  it('picks the first substantive heading/paragraph inside the viewport', () => {
    setup(
      '<h1 id="a">This heading has enough text to serve as an anchor</h1>' +
        '<p id="b">Also a valid anchor paragraph of some length</p>',
    );
    fakeRect(document.getElementById('a')!, 100, 40);
    fakeRect(document.getElementById('b')!, 200, 60);
    expect(computeAnchor(document, window)).toBe(
      'This heading has enough text to serve as an anchor',
    );
  });

  it('skips elements shorter than the anchor min length', () => {
    setup(
      '<h1 id="short">Web</h1>' +
        '<p id="long">A longer paragraph the reader is likely to be viewing</p>',
    );
    fakeRect(document.getElementById('short')!, 100, 40);
    fakeRect(document.getElementById('long')!, 200, 40);
    expect(computeAnchor(document, window)).toBe(
      'A longer paragraph the reader is likely to be viewing',
    );
  });

  it('picks anchor content from div-only SPA markup', () => {
    setup(
      '<div id="chat"><div id="msg">This is the assistant reply text spanning multiple sentences.</div></div>',
    );
    fakeRect(document.getElementById('chat')!, 0, 800);
    fakeRect(document.getElementById('msg')!, 120, 60);
    expect(computeAnchor(document, window)).toBe(
      'This is the assistant reply text spanning multiple sentences.',
    );
  });

  it('skips elements scrolled fully above the viewport', () => {
    setup(
      '<h1 id="a">This heading is scrolled off screen entirely</h1>' +
        '<p id="b">This paragraph is what the user is currently reading</p>',
    );
    fakeRect(document.getElementById('a')!, -200, 40);
    fakeRect(document.getElementById('b')!, 50, 40);
    expect(computeAnchor(document, window)).toBe(
      'This paragraph is what the user is currently reading',
    );
  });

  it('skips elements scrolled fully below the viewport', () => {
    setup(
      '<p id="a">This text is far below the viewport bottom, invisible</p>' +
        '<p id="b">Also below, still invisible to the reader right now</p>',
    );
    fakeRect(document.getElementById('a')!, 900, 40);
    fakeRect(document.getElementById('b')!, 950, 40);
    expect(computeAnchor(document, window)).toBe('');
  });

  it('normalises whitespace', () => {
    setup('<p id="a">   this   paragraph\n   has\n   messy   whitespace  </p>');
    fakeRect(document.getElementById('a')!, 100, 40);
    expect(computeAnchor(document, window)).toBe('this paragraph has messy whitespace');
  });

  it('truncates long text to the configured max', () => {
    const long = 'x'.repeat(500);
    setup(`<p id="a">${long}</p>`);
    fakeRect(document.getElementById('a')!, 100, 40);
    expect(computeAnchor(document, window)).toHaveLength(200);
  });

  it('skips container-sized elements whose text spans the whole page', () => {
    // A page-sized wrapper div with all the content in it — anchor should
    // skip and land on a deeper element with tighter text.
    const inner = 'A specific paragraph the reader is looking at right now.';
    setup(
      `<div id="app">${'padding '.repeat(300)}<p id="para">${inner}</p></div>`,
    );
    fakeRect(document.getElementById('app')!, 0, 800);
    fakeRect(document.getElementById('para')!, 120, 40);
    expect(computeAnchor(document, window)).toBe(inner);
  });

  it('returns empty string when nothing substantive is in view', () => {
    setup('<div id="tiny">Hi</div>');
    fakeRect(document.getElementById('tiny')!, 100, 40);
    expect(computeAnchor(document, window)).toBe('');
  });
});

describe('computeAnchor — elementFromPoint primary path', () => {
  it('prefers the element at the center of the viewport over sidebar/nav', () => {
    // Two candidates would intersect the viewport in DOM order: the nav
    // sidebar (first in DOM) and the article (later). If elementFromPoint
    // resolves the article, the anchor should come from the article
    // even though the nav is first in DOM order.
    setup(
      '<nav id="nav">Nav Link One Nav Link Two Nav Link Three Nav Link Four</nav>' +
        '<article id="article">The article body paragraph the reader is looking at.</article>',
    );
    fakeRect(document.getElementById('nav')!, 0, 800);
    fakeRect(document.getElementById('article')!, 100, 600);
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null })
      .elementFromPoint = () => document.getElementById('article');
    expect(computeAnchor(document, window)).toBe(
      'The article body paragraph the reader is looking at.',
    );
  });

  it('walks up from the hit element until it finds substantive text', () => {
    setup('<div id="wrap"><span id="tiny">x</span> more content that makes this useful</div>');
    fakeRect(document.getElementById('wrap')!, 100, 100);
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null })
      .elementFromPoint = () => document.getElementById('tiny');
    // "tiny" text is 1 char (below min), so we climb to #wrap.
    expect(computeAnchor(document, window)).toBe(
      'x more content that makes this useful',
    );
  });

  it('stops climbing and falls back when it overshoots into a page-sized wrapper', () => {
    // The elementFromPoint hit lives inside a giant container whose text
    // exceeds ANCHOR_MAX_ELEMENT_TEXT. We should stop climbing and use the
    // querySelectorAll fallback instead of returning the whole-page text.
    const inner = 'A specific fine-grained paragraph text.';
    setup(
      `<div id="app">${'padding '.repeat(400)}<p id="para">${inner}</p></div>`,
    );
    fakeRect(document.getElementById('app')!, 0, 800);
    fakeRect(document.getElementById('para')!, 100, 40);
    // Simulate elementFromPoint hitting the outer #app directly.
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null })
      .elementFromPoint = () => document.getElementById('app');
    // Fallback finds the paragraph.
    expect(computeAnchor(document, window)).toBe(inner);
  });

  it('skips non-text tags (svg, canvas) hit by the sample point', () => {
    setup(
      '<svg id="chart"></svg>' +
        '<p id="p">A substantive paragraph elsewhere on the page.</p>',
    );
    fakeRect(document.getElementById('chart')!, 100, 400);
    fakeRect(document.getElementById('p')!, 200, 40);
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null })
      .elementFromPoint = () => document.getElementById('chart');
    // Falls through to the querySelectorAll fallback, which finds the <p>.
    expect(computeAnchor(document, window)).toBe(
      'A substantive paragraph elsewhere on the page.',
    );
  });
});

describe('captureState', () => {
  it('bundles scroll and anchor into one object', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 42 });
    setup('<h1 id="a">Some heading that is long enough to be usable</h1>');
    fakeRect(document.getElementById('a')!, 100, 40);
    expect(captureState(document, window)).toEqual({
      scrollY: 42,
      anchorText: 'Some heading that is long enough to be usable',
    });
  });
});
