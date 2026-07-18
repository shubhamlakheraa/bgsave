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
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.tabCount === 'number' &&
    typeof value.updatedAt === 'number'
  );
}

export function isProfileIndex(value: unknown): value is ProfileIndexEntry[] {
  return Array.isArray(value) && value.every(isProfileIndexEntry);
}
