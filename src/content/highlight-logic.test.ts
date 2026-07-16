// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  HIGHLIGHT_CLASS,
  buildTextMap,
  extractHighlight,
  findHighlightRange,
  findHighlightSpansInRange,
  readSpanHighlight,
  unwrapSpan,
  wrapRange,
} from './highlight-logic';

// Select a range spanning `[startText, endText]` in the flattened body
// text. Helper on top of buildTextMap since jsdom's window.getSelection is
// awkward to drive.
function rangeFor(text: string): Range {
  const map = buildTextMap(document.body);
  const idx = map.text.indexOf(text);
  if (idx < 0) throw new Error(`text ${JSON.stringify(text)} not found`);
  const start = idx;
  const end = idx + text.length;
  const startSeg = map.segments.find((s) => start >= s.start && start < s.end)!;
  const endSeg = map.segments.find((s) => end > s.start && end <= s.end)!;
  const range = document.createRange();
  range.setStart(startSeg.node, start - startSeg.start);
  range.setEnd(endSeg.node, end - endSeg.start);
  return range;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildTextMap', () => {
  it('concatenates text across elements', () => {
    document.body.innerHTML = '<p>Alpha <b>beta</b> gamma</p>';
    const map = buildTextMap(document.body);
    expect(map.text).toBe('Alpha beta gamma');
    expect(map.segments).toHaveLength(3);
  });

  it('skips <script> and <style> content', () => {
    document.body.innerHTML =
      '<p>Real</p><script>evil()</script><style>.x{}</style><p>Also real</p>';
    const map = buildTextMap(document.body);
    expect(map.text).toBe('RealAlso real');
  });
});

describe('extractHighlight', () => {
  it('captures text plus an anchor prefix', () => {
    document.body.innerHTML = '<p>Some preamble text before the target phrase here.</p>';
    const range = rangeFor('target phrase');
    const h = extractHighlight(range, document.body);
    expect(h).not.toBeNull();
    expect(h!.text).toBe('target phrase');
    // Anchor is the text immediately preceding the range.
    expect(h!.anchor.endsWith('before the ')).toBe(true);
  });

  it('returns null for a collapsed range', () => {
    document.body.innerHTML = '<p>text</p>';
    const range = document.createRange();
    range.setStart(document.body.firstChild!.firstChild!, 2);
    range.setEnd(document.body.firstChild!.firstChild!, 2);
    expect(extractHighlight(range, document.body)).toBeNull();
  });

  it('caps the highlighted text at the configured max', () => {
    const big = 'x'.repeat(2000);
    document.body.innerHTML = `<p>${big}</p>`;
    const range = rangeFor(big);
    const h = extractHighlight(range, document.body);
    expect(h!.text).toHaveLength(1000);
  });
});

describe('findHighlightRange', () => {
  it('locates the same range on the same page', () => {
    document.body.innerHTML = '<p>Read this: important phrase you saved.</p>';
    const original = rangeFor('important phrase');
    const h = extractHighlight(original, document.body)!;
    const found = findHighlightRange(document.body, h)!;
    expect(found.toString()).toBe('important phrase');
  });

  it('disambiguates when the same text appears multiple times', () => {
    document.body.innerHTML =
      '<p>Warning appears here. Warning appears there too.</p>';
    // First "Warning" preceded by "".
    // Second "Warning" preceded by "here. ".
    const secondRange = document.createRange();
    const textNode = document.body.firstChild!.firstChild! as Text;
    const secondStart = textNode.data.indexOf('Warning', 10);
    secondRange.setStart(textNode, secondStart);
    secondRange.setEnd(textNode, secondStart + 'Warning'.length);
    const h = extractHighlight(secondRange, document.body)!;
    expect(h.anchor.endsWith('here. ')).toBe(true);
    // Finding by that anchor should get the second occurrence.
    const found = findHighlightRange(document.body, h)!;
    expect(found.startOffset).toBe(secondStart);
  });

  it('returns null when the anchor+text no longer appears (page changed)', () => {
    document.body.innerHTML = '<p>Now the page is different.</p>';
    const stale = { text: 'phrase', anchor: 'that no longer' };
    expect(findHighlightRange(document.body, stale)).toBeNull();
  });

  it('finds the same text across nested elements', () => {
    document.body.innerHTML = '<p>Prefix <b>bold word</b> suffix</p>';
    const original = rangeFor('bold word');
    const h = extractHighlight(original, document.body)!;
    const found = findHighlightRange(document.body, h)!;
    expect(found.toString()).toBe('bold word');
  });
});

describe('wrapRange + unwrapSpan roundtrip', () => {
  it('wraps a single-text-node range in one span', () => {
    document.body.innerHTML = '<p>Some target text here.</p>';
    const range = rangeFor('target text');
    const spans = wrapRange(range, { text: 'target text', anchor: 'Some ' });
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe('target text');
    expect(spans[0].classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(readSpanHighlight(spans[0])).toEqual({
      text: 'target text',
      anchor: 'Some ',
    });
  });

  it('wraps a multi-node range in multiple spans that share identity', () => {
    document.body.innerHTML = '<p>Prefix <b>middle bold</b> tail end</p>';
    const range = rangeFor('middle bold tail');
    const spans = wrapRange(range, { text: 'middle bold tail', anchor: 'Prefix ' });
    // The range crosses <b>...</b>; expect at least 2 spans.
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const combined = spans.map((s) => s.textContent).join('');
    expect(combined).toBe('middle bold tail');
    for (const s of spans) {
      expect(readSpanHighlight(s)).toEqual({
        text: 'middle bold tail',
        anchor: 'Prefix ',
      });
    }
  });

  it('unwrap restores the DOM textually', () => {
    document.body.innerHTML = '<p>Hello world.</p>';
    const before = document.body.textContent;
    const range = rangeFor('world');
    const spans = wrapRange(range, { text: 'world', anchor: 'Hello ' });
    for (const s of spans) unwrapSpan(s);
    expect(document.body.textContent).toBe(before);
    // Wrapping split the text node; normalize on unwrap should merge them.
    expect(document.body.querySelector('span')).toBeNull();
  });
});

describe('findHighlightSpansInRange', () => {
  it('returns spans that intersect the given range', () => {
    document.body.innerHTML = '<p>Alpha beta gamma delta.</p>';
    const target = rangeFor('beta');
    const spans = wrapRange(target, { text: 'beta', anchor: 'Alpha ' });
    expect(spans).toHaveLength(1);

    const overlap = document.createRange();
    // Select from just before "beta" through the middle of it.
    overlap.selectNode(spans[0]);
    const found = findHighlightSpansInRange(overlap);
    expect(found).toEqual(spans);
  });

  it('returns [] when the range does not touch any highlight', () => {
    document.body.innerHTML = '<p>Alpha beta gamma delta.</p>';
    wrapRange(rangeFor('beta'), { text: 'beta', anchor: 'Alpha ' });
    const away = rangeFor('delta');
    expect(findHighlightSpansInRange(away)).toEqual([]);
  });
});
