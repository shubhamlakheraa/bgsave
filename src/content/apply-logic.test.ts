// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyState, findAnchorElement } from './apply-logic';

// jsdom doesn't do real layout, so window.scrollY doesn't move when you
// call scrollTo. We simulate by installing a fake scrollTo that writes to
// a mutable scrollY, plus a "max scrollable" cap for the clamp scenario.
function installScroll(maxScrollY: number) {
  let y = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  window.scrollTo = ((arg: number | ScrollToOptions, _y?: number) => {
    const target = typeof arg === 'number' ? _y! : (arg.top ?? 0);
    y = Math.min(Math.max(0, target), maxScrollY);
  }) as typeof window.scrollTo;
}

// Anchors used in tests must be >= 20 chars to be accepted by applyState;
// this mirrors ANCHOR_MIN_APPLY_LEN. Short strings would be silently
// treated as "no anchor" — which would test the wrong branch.
const LONG_ANCHOR = 'the substantive phrase we are looking for';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findAnchorElement', () => {
  it('returns the element containing the anchor text', () => {
    document.body.innerHTML = '<article><h2 id="target">Anchor phrase here</h2></article>';
    const el = findAnchorElement(document, 'Anchor phrase');
    expect(el?.id).toBe('target');
  });

  it('walks up from a text node when the match spans children', () => {
    document.body.innerHTML = '<div id="wrap">Prefix <b>middle</b> tail</div>';
    const el = findAnchorElement(document, 'Prefix middle');
    // Match starts in the first text node under #wrap; we want the parent
    // Element, not the raw text node.
    expect(el?.id).toBe('wrap');
  });

  it('returns null when the anchor is not present', () => {
    document.body.innerHTML = '<p>Only this text</p>';
    expect(findAnchorElement(document, 'not there')).toBeNull();
  });

  it('returns null on empty anchor', () => {
    document.body.innerHTML = '<p>x</p>';
    expect(findAnchorElement(document, '')).toBeNull();
  });
});

describe('applyState', () => {
  it("returns 'noop' when neither scrollY nor anchor is provided", () => {
    installScroll(0);
    expect(applyState(document, window, {})).toBe('noop');
  });

  it("scrolls to scrollY first, then anchor refines and wins the return value", () => {
    installScroll(5000);
    document.body.innerHTML = `<p id="p">Some page text about ${LONG_ANCHOR} for restore.</p>`;
    const spy = vi.fn();
    document.getElementById('p')!.scrollIntoView = spy;
    const result = applyState(document, window, {
      scrollY: 1200,
      anchorText: LONG_ANCHOR,
    });
    expect(result).toBe('anchor');
    expect(spy).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    // scrollY is applied first (to trigger virtualization) — window.scrollY
    // moved to 1200 before anchor's scrollIntoView ran.
    expect(window.scrollY).toBe(1200);
  });

  it("falls back to scrollY when the anchor missed and scrollY is provided", () => {
    installScroll(5000);
    document.body.innerHTML = '<p>Nothing containing the saved anchor phrase.</p>';
    expect(
      applyState(document, window, {
        scrollY: 1200,
        anchorText: LONG_ANCHOR,
      }),
    ).toBe('scrollY');
    expect(window.scrollY).toBe(1200);
  });

  it("uses raw scrollY when only scrollY is provided", () => {
    installScroll(5000);
    expect(applyState(document, window, { scrollY: 1200 })).toBe('scrollY');
    expect(window.scrollY).toBe(1200);
  });

  it("ignores anchors shorter than the min-apply length", () => {
    // "short" (5 chars) is below the min-apply threshold, so applyState
    // treats it as if no anchor was provided and falls through to scrollY.
    installScroll(5000);
    document.body.innerHTML = '<p>Contains short in here.</p>';
    const p = document.body.querySelector('p')!;
    const scrollSpy = vi.fn();
    p.scrollIntoView = scrollSpy;
    expect(
      applyState(document, window, { scrollY: 300, anchorText: 'short' }),
    ).toBe('scrollY');
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("returns 'failed' when anchor missed and scrollY clamps", () => {
    installScroll(0);
    document.body.innerHTML = '<p>Nothing matches.</p>';
    const result = applyState(document, window, {
      scrollY: 999,
      anchorText: LONG_ANCHOR,
    });
    expect(result).toBe('failed');
  });

  it("uses anchor path when scrollY is absent but anchor is present", () => {
    installScroll(5000);
    document.body.innerHTML = `<h1 id="h">${LONG_ANCHOR}</h1>`;
    const spy = vi.fn();
    document.getElementById('h')!.scrollIntoView = spy;
    const result = applyState(document, window, { anchorText: LONG_ANCHOR });
    expect(result).toBe('anchor');
    expect(spy).toHaveBeenCalled();
  });
});
