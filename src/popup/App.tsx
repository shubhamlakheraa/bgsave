import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../shared/constants';
import { sendToBackground, type RestoreSummary } from '../shared/messaging';
import { formatRelativeTime } from '../shared/time';
import { isRestrictedUrl } from '../background/capture';
import type { Profile, ProfileIndexEntry, SavedTab } from '../shared/types';
import { tabHasState } from '../shared/validators';

type ConnStatus = 'pending' | 'connected' | 'disconnected';
type Mode = 'list' | 'freezing' | 'saving';

interface Toast {
  kind: 'success' | 'error';
  message: string;
}

interface TabRow {
  id: number;
  title: string;
  url: string;
  host: string;
  favIconUrl?: string;
  restricted: boolean;
  pinned: boolean;
}

function summarizeRestore(s: RestoreSummary): string {
  const parts: string[] = [`Restored ${s.tabsCreated} tab${s.tabsCreated === 1 ? '' : 's'}`];
  if (s.tabsWithState > 0) parts.push(`${s.tabsWithState} with state`);
  if (s.tabsFailed > 0) parts.push(`${s.tabsFailed} drifted`);
  return parts.join(' · ');
}

// Cache entry for a lazily fetched profile preview. Keyed by the profile's
// updatedAt so a workspace re-saved under the same id auto-invalidates.
interface PreviewCacheEntry {
  updatedAt: number;
  profile: Profile;
}

export function App() {
  const [profiles, setProfiles] = useState<ProfileIndexEntry[] | null>(null);
  const [conn, setConn] = useState<ConnStatus>('pending');
  const [mode, setMode] = useState<Mode>('list');
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [previewCache, setPreviewCache] = useState<Map<string, PreviewCacheEntry>>(
    new Map(),
  );
  const [previewLoading, setPreviewLoading] = useState<Set<string>>(new Set());
  const [previewError, setPreviewError] = useState<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const list = await sendToBackground({ type: 'LIST_PROFILES' });
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      setProfiles(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await sendToBackground({ type: 'PING' });
        if (cancelled) return;
        setConn('connected');
        await refresh();
      } catch (err) {
        if (cancelled) return;
        setConn('disconnected');
        console.error(`[${APP_NAME}] background unreachable:`, err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleFreeze = useCallback(
    async (name: string, tabIds: number[]) => {
      setMode('saving');
      setError(null);
      try {
        await sendToBackground({ type: 'FREEZE_WORKSPACE', name, tabIds });
        await refresh();
        setMode('list');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setMode('freezing');
      }
    },
    [refresh],
  );

  const handleToggleExpand = useCallback(
    async (entry: ProfileIndexEntry) => {
      const { id, updatedAt } = entry;
      const wasOpen = expandedIds.has(id);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (wasOpen) next.delete(id);
        else next.add(id);
        return next;
      });
      if (wasOpen) return;

      // Serve from cache if it matches the current updatedAt; otherwise fetch.
      const cached = previewCache.get(id);
      if (cached && cached.updatedAt === updatedAt) return;

      setPreviewLoading((prev) => new Set(prev).add(id));
      setPreviewError((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      try {
        const profile = await sendToBackground({ type: 'GET_PROFILE', id });
        if (!profile) throw new Error('Workspace not found.');
        setPreviewCache((prev) => {
          const next = new Map(prev);
          next.set(id, { updatedAt: profile.updatedAt, profile });
          return next;
        });
      } catch (err) {
        setPreviewError((prev) => {
          const next = new Map(prev);
          next.set(id, err instanceof Error ? err.message : String(err));
          return next;
        });
      } finally {
        setPreviewLoading((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [expandedIds, previewCache],
  );

  const handleRestore = useCallback(async (id: string) => {
    setRestoringId(id);
    setToast(null);
    try {
      const summary = await sendToBackground({ type: 'RESTORE_WORKSPACE', id });
      setToast({ kind: 'success', message: summarizeRestore(summary) });
    } catch (err) {
      setToast({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRestoringId(null);
    }
  }, []);

  return (
    <main className="popup">
      <header className="popup__header">
        <h1 className="popup__title">{APP_NAME}</h1>
        {mode === 'list' && (
          <div className="popup__header-actions">
            <button
              type="button"
              className="popup__manage"
              onClick={() => chrome.runtime.openOptionsPage()}
              title="Manage workspaces"
              aria-label="Manage workspaces"
            >
              ⚙
            </button>
            <button
              type="button"
              className="popup__freeze"
              onClick={() => {
                setError(null);
                setMode('freezing');
              }}
              disabled={conn !== 'connected'}
            >
              + Freeze
            </button>
          </div>
        )}
      </header>

      {(mode === 'freezing' || mode === 'saving') && (
        <FreezeForm
          disabled={mode === 'saving'}
          existingNames={profiles?.map((p) => p.name) ?? []}
          onCancel={() => {
            setError(null);
            setMode('list');
          }}
          onSubmit={handleFreeze}
        />
      )}

      {error && <p className="popup__error">{error}</p>}

      {toast && (
        <p className={`popup__toast popup__toast--${toast.kind}`}>{toast.message}</p>
      )}

      {mode === 'list' && (
        <ProfileList
          profiles={profiles}
          restoringId={restoringId}
          expandedIds={expandedIds}
          previewCache={previewCache}
          previewLoading={previewLoading}
          previewError={previewError}
          onToggleExpand={handleToggleExpand}
          onRestore={handleRestore}
        />
      )}

      <footer className={`popup__status popup__status--${conn}`}>
        <span className="popup__status-dot" aria-hidden />
        <span className="popup__status-label">
          {conn === 'pending' && 'connecting…'}
          {conn === 'connected' && 'background OK'}
          {conn === 'disconnected' && 'background unreachable'}
        </span>
      </footer>
    </main>
  );
}

function driftLabel(tabCount: number, tabsWithState: number | undefined): string {
  if (tabsWithState === undefined) return '';
  if (tabsWithState === 0) return 'metadata only';
  if (tabsWithState === tabCount) return 'all with state';
  return `${tabsWithState} with state`;
}

function ProfileList({
  profiles,
  restoringId,
  expandedIds,
  previewCache,
  previewLoading,
  previewError,
  onToggleExpand,
  onRestore,
}: {
  profiles: ProfileIndexEntry[] | null;
  restoringId: string | null;
  expandedIds: Set<string>;
  previewCache: Map<string, PreviewCacheEntry>;
  previewLoading: Set<string>;
  previewError: Map<string, string>;
  onToggleExpand: (entry: ProfileIndexEntry) => void;
  onRestore: (id: string) => void;
}) {
  if (profiles === null) {
    return <p className="popup__hint">Loading workspaces…</p>;
  }
  if (profiles.length === 0) {
    return (
      <p className="popup__hint">
        No workspaces yet. Click <strong>+ Freeze</strong> to save this window.
      </p>
    );
  }
  const now = Date.now();
  const busy = restoringId !== null;
  return (
    <ul className="popup__list">
      {profiles.map((p) => {
        const isRestoringThis = restoringId === p.id;
        const isOpen = expandedIds.has(p.id);
        const cached = previewCache.get(p.id);
        const drift = driftLabel(p.tabCount, p.tabsWithState);
        return (
          <li key={p.id} className="popup__row-wrap">
            <div className="popup__row">
              <button
                type="button"
                className="popup__chevron"
                onClick={() => onToggleExpand(p)}
                aria-expanded={isOpen}
                aria-label={isOpen ? 'Collapse workspace' : 'Expand workspace'}
              >
                {isOpen ? '▾' : '▸'}
              </button>
              <div className="popup__row-info">
                <span className="popup__row-name">{p.name}</span>
                <span className="popup__row-meta">
                  {p.tabCount} tab{p.tabCount === 1 ? '' : 's'}
                  {drift && (
                    <>
                      {' · '}
                      <span
                        className={
                          p.tabsWithState === 0
                            ? 'popup__drift popup__drift--none'
                            : 'popup__drift'
                        }
                      >
                        {drift}
                      </span>
                    </>
                  )}
                  {' · '}
                  {formatRelativeTime(p.updatedAt, now)}
                </span>
              </div>
              <button
                type="button"
                className="popup__row-action"
                onClick={() => onRestore(p.id)}
                disabled={busy}
              >
                {isRestoringThis ? 'Restoring…' : 'Restore'}
              </button>
            </div>
            {isOpen && (
              <PreviewPanel
                loading={previewLoading.has(p.id)}
                error={previewError.get(p.id) ?? null}
                profile={cached?.profile ?? null}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PreviewPanel({
  loading,
  error,
  profile,
}: {
  loading: boolean;
  error: string | null;
  profile: Profile | null;
}) {
  if (loading && !profile) {
    return <p className="popup__preview-hint">Loading tabs…</p>;
  }
  if (error) {
    return <p className="popup__preview-error">{error}</p>;
  }
  if (!profile) return null;
  const tabs: SavedTab[] = profile.windows.flatMap((w) => w.tabs);
  if (tabs.length === 0) {
    return <p className="popup__preview-hint">No tabs in this workspace.</p>;
  }
  return (
    <ul className="popup__preview">
      {tabs.map((t, i) => {
        const markers: string[] = [];
        if (typeof t.scrollY === 'number' && t.scrollY >= 100) markers.push('scroll');
        if (typeof t.anchorText === 'string' && t.anchorText.length > 0) markers.push('anchor');
        if (t.highlights && t.highlights.length > 0) markers.push('highlights');
        if (t.frames && t.frames.length > 0) markers.push('iframe');
        const hasState = tabHasState(t);
        return (
          <li key={`${t.url}-${i}`} className="popup__preview-row">
            <span className="popup__preview-title" title={t.title}>
              {t.title || '(untitled)'}
            </span>
            <span className="popup__preview-url" title={t.url}>
              {t.restricted ? 'restricted' : hostOf(t.url)}
            </span>
            {hasState && markers.length > 0 && (
              <span className="popup__preview-markers" title={markers.join(' · ')}>
                {markers.map((m) => m[0]).join('')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function FreezeForm({
  disabled,
  existingNames,
  onCancel,
  onSubmit,
}: {
  disabled: boolean;
  existingNames: string[];
  onCancel: () => void;
  onSubmit: (name: string, tabIds: number[]) => void;
}) {
  const [name, setName] = useState('');
  const [tabs, setTabs] = useState<TabRow[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    (async () => {
      const raw = await chrome.tabs.query({ currentWindow: true });
      const rows: TabRow[] = raw
        .filter((t): t is chrome.tabs.Tab & { id: number } => typeof t.id === 'number')
        .map((t) => {
          const url = t.url ?? t.pendingUrl ?? '';
          return {
            id: t.id,
            title: t.title ?? '(untitled)',
            url,
            host: hostOf(url),
            favIconUrl: t.favIconUrl,
            restricted: isRestrictedUrl(url),
            pinned: t.pinned ?? false,
          };
        });
      setTabs(rows);
      setSelected(new Set(rows.map((r) => r.id)));
    })();
  }, []);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (localError) setLocalError(null);
  };

  const toggleAll = () => {
    if (!tabs) return;
    setSelected((prev) => (prev.size === tabs.length ? new Set() : new Set(tabs.map((t) => t.id))));
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Name cannot be empty.');
      return;
    }
    if (trimmed.length > 60) {
      setLocalError('Name must be 60 characters or fewer.');
      return;
    }
    const lower = trimmed.toLowerCase();
    if (existingNames.some((n) => n.toLowerCase() === lower)) {
      setLocalError('A workspace with this name already exists.');
      return;
    }
    if (selected.size === 0) {
      setLocalError('Select at least one tab.');
      return;
    }
    setLocalError(null);
    onSubmit(trimmed, Array.from(selected));
  };

  const allChecked = tabs !== null && selected.size === tabs.length;

  return (
    <form
      className="popup__form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) submit();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        className="popup__input"
        placeholder="Workspace name"
        value={name}
        maxLength={60}
        disabled={disabled}
        onChange={(e) => {
          setName(e.target.value);
          if (localError) setLocalError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />

      {tabs === null ? (
        <p className="popup__hint">Loading tabs…</p>
      ) : (
        <>
          <div className="popup__picker-header">
            <button
              type="button"
              className="popup__link"
              onClick={toggleAll}
              disabled={disabled}
            >
              {allChecked ? 'Deselect all' : 'Select all'}
            </button>
            <span className="popup__picker-count">
              {selected.size} / {tabs.length} selected
            </span>
          </div>
          <ul className="popup__picker">
            {tabs.map((t) => (
              <li key={t.id} className="popup__picker-row">
                <label className="popup__picker-label">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    disabled={disabled}
                  />
                  {t.favIconUrl ? (
                    <img className="popup__picker-icon" src={t.favIconUrl} alt="" />
                  ) : (
                    <span className="popup__picker-icon popup__picker-icon--blank" />
                  )}
                  <span className="popup__picker-title" title={t.title}>
                    {t.title}
                  </span>
                  <span className="popup__picker-host" title={t.url}>
                    {t.restricted ? 'metadata only' : t.host}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="popup__form-actions">
        <button type="button" className="popup__btn" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
        <button type="submit" className="popup__btn popup__btn--primary" disabled={disabled}>
          {disabled ? 'Saving…' : 'Save'}
        </button>
      </div>
      {localError && <p className="popup__error">{localError}</p>}
    </form>
  );
}
