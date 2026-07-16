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
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});

describe('computeScroll', () => {
  it('returns floored window.scrollY', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 123.7 });
    expect(computeScroll(window)).toBe(123);
  });
});

describe('computeAnchor', () => {
  it('picks the first heading/paragraph inside the viewport', () => {
    setup('<h1 id="a">Above the fold</h1><p id="b">Also here</p>');
    fakeRect(document.getElementById('a')!, 100, 40);
    fakeRect(document.getElementById('b')!, 200, 60);
    expect(computeAnchor(document, window)).toBe('Above the fold');
  });

  it('skips elements scrolled fully above the viewport', () => {
    setup('<h1 id="a">Off screen</h1><p id="b">Visible</p>');
    fakeRect(document.getElementById('a')!, -200, 40);
    fakeRect(document.getElementById('b')!, 50, 40);
    expect(computeAnchor(document, window)).toBe('Visible');
  });

  it('skips elements scrolled fully below the viewport', () => {
    setup('<p id="a">Top</p><p id="b">Bottom</p>');
    fakeRect(document.getElementById('a')!, 900, 40);
    fakeRect(document.getElementById('b')!, 950, 40);
    expect(computeAnchor(document, window)).toBe('');
  });

  it('normalises whitespace', () => {
    setup('<p id="a">   multi\n   line\n   text  </p>');
    fakeRect(document.getElementById('a')!, 100, 40);
    expect(computeAnchor(document, window)).toBe('multi line text');
  });

  it('truncates long text to the configured max', () => {
    setup(`<p id="a">${'x'.repeat(500)}</p>`);
    fakeRect(document.getElementById('a')!, 100, 40);
    expect(computeAnchor(document, window)).toHaveLength(200);
  });

  it('returns empty string when nothing text-bearing is visible', () => {
    setup('<div>Not in candidate list</div>');
    expect(computeAnchor(document, window)).toBe('');
  });
});

describe('captureState', () => {
  it('bundles scroll and anchor into one object', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 42 });
    setup('<h1 id="a">Hello</h1>');
    fakeRect(document.getElementById('a')!, 100, 40);
    expect(captureState(document, window)).toEqual({ scrollY: 42, anchorText: 'Hello' });
  });
});
