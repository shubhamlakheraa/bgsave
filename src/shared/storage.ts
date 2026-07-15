import {
  STORAGE_KEYS,
  SCHEMA_VERSION,
  corruptedKey,
  profileKey,
} from './constants';
import type { KVStore } from './kvStore';
import type {
  Profile,
  ProfileIndexEntry,
  ValidationResult,
} from './types';
import {
  isProfile,
  isProfileIndex,
  normalizeName,
  validateProfileName,
} from './validators';

/**
 * ProfileStore — CRUD over profiles with crash-safe write ordering.
 *
 * Storage layout:
 *   profileIndex        : ProfileIndexEntry[]     (lightweight, always small)
 *   profile:<uuid>      : Profile                 (full payload)
 *   __corrupted:<uuid>  : unknown                 (quarantined bad reads)
 *
 * Design notes:
 * - Reads validate; anything malformed is quarantined and returned as null.
 * - Save order: write blob first, then update index (crash → orphan blob, safe).
 * - Delete order: remove from index first, then blob (crash → orphan blob, safe).
 * - Never leave a UI-visible index entry pointing at a missing blob.
 */
export class ProfileStore {
  constructor(private readonly kv: KVStore) {}

  // ---------- read paths ----------

  async listProfiles(): Promise<ProfileIndexEntry[]> {
    const raw = await this.kv.get<unknown>(STORAGE_KEYS.PROFILE_INDEX);
    if (raw === null) return [];
    if (!isProfileIndex(raw)) {
      // The index itself is corrupt. Quarantine and start fresh.
      await this.kv.set(corruptedKey('profileIndex'), raw);
      await this.kv.set(STORAGE_KEYS.PROFILE_INDEX, []);
      return [];
    }
    return raw;
  }

  async getProfile(id: string): Promise<Profile | null> {
    const key = profileKey(id);
    const raw = await this.kv.get<unknown>(key);
    if (raw === null) return null;
    if (!isProfile(raw)) {
      // Malformed profile — quarantine, drop from index, return null.
      await this.kv.set(corruptedKey(id), raw);
      await this.kv.remove(key);
      const index = await this.listProfiles();
      const cleaned = index.filter((entry) => entry.id !== id);
      if (cleaned.length !== index.length) {
        await this.kv.set(STORAGE_KEYS.PROFILE_INDEX, cleaned);
      }
      return null;
    }
    return raw;
  }

  // ---------- write paths ----------

  /**
   * Insert or update a profile. Validates the name against existing entries
   * (excluding the profile's own id when updating). Bumps updatedAt.
   */
  async saveProfile(profile: Profile): Promise<void> {
    if (profile.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(
        `Unsupported schema version ${profile.schemaVersion}; expected ${SCHEMA_VERSION}.`,
      );
    }

    const index = await this.listProfiles();
    const nameCheck = validateProfileName(profile.name, index, profile.id);
    if (!nameCheck.ok) {
      throw new Error(nameCheck.error);
    }

    const now = Date.now();
    const normalized: Profile = {
      ...profile,
      name: normalizeName(profile.name),
      updatedAt: now,
      createdAt: profile.createdAt || now,
    };

    // 1. Write blob first — index will still be consistent if we crash here.
    await this.kv.set(profileKey(normalized.id), normalized);

    // 2. Then update the index atomically.
    const entry: ProfileIndexEntry = {
      id: normalized.id,
      name: normalized.name,
      tabCount: normalized.windows.reduce((sum, w) => sum + w.tabs.length, 0),
      updatedAt: normalized.updatedAt,
    };
    const existingIdx = index.findIndex((e) => e.id === normalized.id);
    const nextIndex =
      existingIdx === -1
        ? [...index, entry]
        : index.map((e, i) => (i === existingIdx ? entry : e));

    await this.kv.set(STORAGE_KEYS.PROFILE_INDEX, nextIndex);
  }

  async renameProfile(id: string, newName: string): Promise<void> {
    const existing = await this.getProfile(id);
    if (!existing) throw new Error(`Profile ${id} not found.`);
    await this.saveProfile({ ...existing, name: newName });
  }

  async deleteProfile(id: string): Promise<void> {
    // Remove index entry FIRST — never leave the UI showing a row for a
    // profile whose blob is already gone.
    const index = await this.listProfiles();
    const nextIndex = index.filter((entry) => entry.id !== id);
    if (nextIndex.length !== index.length) {
      await this.kv.set(STORAGE_KEYS.PROFILE_INDEX, nextIndex);
    }
    await this.kv.remove(profileKey(id));
  }

  // ---------- helpers ----------

  /**
   * Validate a name without touching storage-mutation paths. UI can call this
   * for inline feedback in the freeze/rename dialog.
   */
  async validateName(name: string, excludeId?: string): Promise<ValidationResult> {
    const index = await this.listProfiles();
    return validateProfileName(name, index, excludeId);
  }
}
