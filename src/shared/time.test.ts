import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './time';

const NOW = 1_700_000_000_000;
const s = (n: number) => n * 1000;
const m = (n: number) => n * 60_000;
const h = (n: number) => n * 3_600_000;
const d = (n: number) => n * 86_400_000;

describe('formatRelativeTime', () => {
  it('returns "just now" for anything under a minute', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - s(30), NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - s(59), NOW)).toBe('just now');
  });

  it('formats minutes', () => {
    expect(formatRelativeTime(NOW - m(1), NOW)).toBe('1m ago');
    expect(formatRelativeTime(NOW - m(45), NOW)).toBe('45m ago');
  });

  it('formats hours', () => {
    expect(formatRelativeTime(NOW - h(1), NOW)).toBe('1h ago');
    expect(formatRelativeTime(NOW - h(23), NOW)).toBe('23h ago');
  });

  it('formats days', () => {
    expect(formatRelativeTime(NOW - d(1), NOW)).toBe('1d ago');
    expect(formatRelativeTime(NOW - d(29), NOW)).toBe('29d ago');
  });

  it('formats months and years', () => {
    expect(formatRelativeTime(NOW - d(30), NOW)).toBe('1mo ago');
    expect(formatRelativeTime(NOW - d(200), NOW)).toBe('6mo ago');
    expect(formatRelativeTime(NOW - d(365), NOW)).toBe('1y ago');
    expect(formatRelativeTime(NOW - d(365 * 3), NOW)).toBe('3y ago');
  });

  it('treats future timestamps as "just now" (clock skew safety)', () => {
    expect(formatRelativeTime(NOW + m(5), NOW)).toBe('just now');
  });
});
