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

  it("returns 'scrollY' when the exact position lands within tolerance", () => {
    installScroll(5000);
    expect(applyState(document, window, { scrollY: 1200 })).toBe('scrollY');
    expect(window.scrollY).toBe(1200);
  });

  it("falls back to 'anchor' when the page is too short for scrollY", () => {
    installScroll(300); // page maxes out at 300, target is 1200 → clamp
    document.body.innerHTML = '<p>Some target phrase for restore.</p>';
    const el = document.body.querySelector('p')!;
    const spy = vi.fn();
    el.scrollIntoView = spy;
    const result = applyState(document, window, {
      scrollY: 1200,
      anchorText: 'target phrase',
    });
    expect(result).toBe('anchor');
    expect(spy).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it("returns 'failed' when neither scrollY lands nor anchor resolves", () => {
    installScroll(0);
    document.body.innerHTML = '<p>Nothing matches.</p>';
    const result = applyState(document, window, {
      scrollY: 999,
      anchorText: 'ghost text',
    });
    expect(result).toBe('failed');
  });

  it('uses anchor path when scrollY is absent but anchor is present', () => {
    installScroll(5000);
    document.body.innerHTML = '<h1 id="h">Anchor Here</h1>';
    const spy = vi.fn();
    document.getElementById('h')!.scrollIntoView = spy;
    const result = applyState(document, window, { anchorText: 'Anchor Here' });
    expect(result).toBe('anchor');
    expect(spy).toHaveBeenCalled();
  });
});
