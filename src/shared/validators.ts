import { LIMITS, SCHEMA_VERSION } from './constants';
import type {
  Highlight,
  Profile,
  ProfileIndexEntry,
  SavedTab,
  SavedWindow,
  ValidationResult,
} from './types';

// Trims whitespace on both ends. Used everywhere we touch user-supplied names.
export function normalizeName(name: string): string {
  return name.trim();
}

// True when a SavedTab carries meaningful cognitive state — a substantive
// scroll position, an anchor, any highlights, or any per-iframe state. Used
// by the drift indicator so a workspace with 12 tabs but only 3 non-trivial
// captures shows "12 tabs · 3 with state" instead of pretending all 12 will
// come back with full context.
//
// scrollY >= 100 is the same "no real scroll" cutoff we apply at restore
// (SPAs commonly report scrollY = 0 no matter how far the user scrolled).
export function tabHasState(tab: SavedTab): boolean {
  if (typeof tab.scrollY === 'number' && tab.scrollY >= 100) return true;
  if (typeof tab.anchorText === 'string' && tab.anchorText.length > 0) return true;
  if (tab.highlights && tab.highlights.length > 0) return true;
  if (tab.frames && tab.frames.some((f) =>
    (typeof f.scrollY === 'number' && f.scrollY >= 100) ||
    (typeof f.anchorText === 'string' && f.anchorText.length > 0),
  )) {
    return true;
  }
  return false;
}

// Sum tabHasState across every window in a profile. Called at save time to
// stash the count into ProfileIndexEntry so the popup can render the drift
// badge without loading each full profile.
export function countTabsWithState(profile: Profile): number {
  let count = 0;
  for (const w of profile.windows) {
    for (const t of w.tabs) {
      if (tabHasState(t)) count++;
    }
  }
  return count;
}

/**
 * Validate a profile name.
 * - Must be 1..60 chars after trimming
 * - Must not collide with an existing profile name (case-insensitive)
 *
 * `excludeId` lets rename skip its own current row when checking duplicates.
 */
export function validateProfileName(
  rawName: string,
  existing: ReadonlyArray<ProfileIndexEntry>,
  excludeId?: string,
): ValidationResult {
  const name = normalizeName(rawName);
  if (name.length < LIMITS.PROFILE_NAME_MIN) {
    return { ok: false, error: 'Name cannot be empty.' };
  }
  if (name.length > LIMITS.PROFILE_NAME_MAX) {
    return { ok: false, error: `Name must be ${LIMITS.PROFILE_NAME_MAX} characters or fewer.` };
  }
  const lower = name.toLowerCase();
  const clash = existing.find(
    (entry) => entry.id !== excludeId && entry.name.toLowerCase() === lower,
  );
  if (clash) {
    return { ok: false, error: 'A workspace with this name already exists.' };
  }
  return { ok: true };
}

// ---------- Runtime type predicates ----------
// These narrow `unknown` (as returned by chrome.storage.local) into typed
// domain objects. Anything that fails is quarantined by the storage layer
// instead of crashing at some later untyped access.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHighlight(value: unknown): value is Highlight {
  return (
    isRecord(value) &&
    typeof value.text === 'string' &&
    typeof value.anchor === 'string'
  );
}

function isFrameState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.url !== 'string') return false;
  if (value.scrollY !== undefined && typeof value.scrollY !== 'number') return false;
  if (value.anchorText !== undefined && typeof value.anchorText !== 'string') return false;
  return true;
}

function isSavedTab(value: unknown): value is SavedTab {
  if (!isRecord(value)) return false;
  if (typeof value.url !== 'string') return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.pinned !== 'boolean') return false;
  if (typeof value.groupId !== 'number') return false;
  if (typeof value.index !== 'number') return false;
  if (typeof value.restricted !== 'boolean') return false;
  if (typeof value.capturedAt !== 'number') return false;
  if (value.scrollY !== undefined && typeof value.scrollY !== 'number') return false;
  if (value.anchorText !== undefined && typeof value.anchorText !== 'string') return false;
  if (value.highlights !== undefined) {
    if (!Array.isArray(value.highlights)) return false;
    if (!value.highlights.every(isHighlight)) return false;
  }
  if (value.frames !== undefined) {
    if (!Array.isArray(value.frames)) return false;
    if (!value.frames.every(isFrameState)) return false;
  }
  return true;
}

function isSavedWindow(value: unknown): value is SavedWindow {
  return (
    isRecord(value) &&
    typeof value.focused === 'boolean' &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isSavedTab)
  );
}

export function isProfile(value: unknown): value is Profile {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.name !== 'string') return false;
  if (value.schemaVersion !== SCHEMA_VERSION) return false;
  if (typeof value.createdAt !== 'number') return false;
  if (typeof value.updatedAt !== 'number') return false;
  if (!Array.isArray(value.windows)) return false;
  if (!value.windows.every(isSavedWindow)) return false;
  return true;
}

export function isProfileIndexEntry(value: unknown): value is ProfileIndexEntry {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.tabCount !== 'number') return false;
  if (typeof value.updatedAt !== 'number') return false;
  // tabsWithState is optional for backwards compatibility with indexes
  // written before the field existed.
  if (value.tabsWithState !== undefined && typeof value.tabsWithState !== 'number') {
    return false;
  }
  return true;
}

export function isProfileIndex(value: unknown): value is ProfileIndexEntry[] {
  return Array.isArray(value) && value.every(isProfileIndexEntry);
}
