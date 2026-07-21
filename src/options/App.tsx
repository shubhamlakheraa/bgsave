import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME, APP_VERSION } from '../shared/constants';
import { sendToBackground } from '../shared/messaging';
import { formatRelativeTime } from '../shared/time';
import type { Profile, ProfileIndexEntry, SavedTab } from '../shared/types';
import { tabHasState } from '../shared/validators';

interface Toast {
  kind: 'success' | 'error';
  message: string;
}

// Same lazy-fetch cache pattern the popup uses — one GET_PROFILE per
// expansion, invalidated when the profile's updatedAt changes.
interface PreviewCacheEntry {
  updatedAt: number;
  profile: Profile;
}

// Confirm-modal state. `null` = closed. When open, we hold a callback so
// the confirm handler doesn't need to know what it's confirming.
interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  destructive: boolean;
  onConfirm: () => Promise<void> | void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function driftLabel(tabCount: number, tabsWithState: number | undefined): string {
  if (tabsWithState === undefined) return '';
  if (tabsWithState === 0) return 'metadata only';
  if (tabsWithState === tabCount) return 'all with state';
  return `${tabsWithState} with state`;
}

export function App() {
  const [profiles, setProfiles] = useState<ProfileIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [previewCache, setPreviewCache] = useState<Map<string, PreviewCacheEntry>>(
    new Map(),
  );
  const [previewLoading, setPreviewLoading] = useState<Set<string>>(new Set());
  const [previewError, setPreviewError] = useState<Map<string, string>>(new Map());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

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
    void refresh();
  }, [refresh]);

  // Toasts auto-dismiss so the page stays scannable — 3s is enough for a
  // "renamed" or "removed" confirmation to register without lingering.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const loadPreview = useCallback(
    async (entry: ProfileIndexEntry, force = false) => {
      const cached = previewCache.get(entry.id);
      if (!force && cached && cached.updatedAt === entry.updatedAt) return;
      setPreviewLoading((prev) => new Set(prev).add(entry.id));
      setPreviewError((prev) => {
        if (!prev.has(entry.id)) return prev;
        const next = new Map(prev);
        next.delete(entry.id);
        return next;
      });
      try {
        const profile = await sendToBackground({ type: 'GET_PROFILE', id: entry.id });
        if (!profile) throw new Error('Workspace not found.');
        setPreviewCache((prev) => {
          const next = new Map(prev);
          next.set(entry.id, { updatedAt: profile.updatedAt, profile });
          return next;
        });
      } catch (err) {
        setPreviewError((prev) => {
          const next = new Map(prev);
          next.set(entry.id, err instanceof Error ? err.message : String(err));
          return next;
        });
      } finally {
        setPreviewLoading((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [previewCache],
  );

  const handleToggleExpand = useCallback(
    (entry: ProfileIndexEntry) => {
      const wasOpen = expandedIds.has(entry.id);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (wasOpen) next.delete(entry.id);
        else next.add(entry.id);
        return next;
      });
      if (!wasOpen) void loadPreview(entry);
    },
    [expandedIds, loadPreview],
  );

  const handleRename = useCallback(
    async (id: string, newName: string) => {
      markBusy(id, true);
      try {
        await sendToBackground({ type: 'RENAME_PROFILE', id, newName });
        setRenamingId(null);
        setToast({ kind: 'success', message: `Renamed to "${newName}".` });
        await refresh();
      } catch (err) {
        setToast({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        markBusy(id, false);
      }
    },
    [markBusy, refresh],
  );

  const handleDelete = useCallback(
    (entry: ProfileIndexEntry) => {
      setConfirm({
        title: 'Delete workspace?',
        body: `"${entry.name}" and its ${entry.tabCount} saved tab${entry.tabCount === 1 ? '' : 's'} will be permanently deleted. This cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
        onConfirm: async () => {
          markBusy(entry.id, true);
          try {
            await sendToBackground({ type: 'DELETE_PROFILE', id: entry.id });
            setToast({ kind: 'success', message: `Deleted "${entry.name}".` });
            // Drop the row's local state so it doesn't linger in the maps.
            setExpandedIds((prev) => {
              const next = new Set(prev);
              next.delete(entry.id);
              return next;
            });
            setPreviewCache((prev) => {
              if (!prev.has(entry.id)) return prev;
              const next = new Map(prev);
              next.delete(entry.id);
              return next;
            });
            await refresh();
          } catch (err) {
            setToast({
              kind: 'error',
              message: err instanceof Error ? err.message : String(err),
            });
          } finally {
            markBusy(entry.id, false);
          }
        },
      });
    },
    [markBusy, refresh],
  );

  const handleRemoveTab = useCallback(
    (entry: ProfileIndexEntry, windowIndex: number, tabIndex: number, tab: SavedTab) => {
      setConfirm({
        title: 'Remove tab?',
        body: `Remove "${tab.title || tab.url}" from "${entry.name}"? The tab's captured scroll and highlights will be dropped.`,
        confirmLabel: 'Remove',
        destructive: true,
        onConfirm: async () => {
          markBusy(entry.id, true);
          try {
            const outcome = await sendToBackground({
              type: 'REMOVE_TAB',
              profileId: entry.id,
              windowIndex,
              tabIndex,
            });
            if (outcome.kind === 'last_tab') {
              setToast({
                kind: 'error',
                message:
                  'This is the last tab. Delete the workspace instead of emptying it.',
              });
              return;
            }
            if (outcome.kind === 'not_found') {
              setToast({ kind: 'error', message: 'Workspace or tab not found.' });
              return;
            }
            setToast({ kind: 'success', message: 'Tab removed.' });
            await refresh();
            // Re-fetch the preview so the tab list drops the removed row.
            await loadPreview({ ...entry, updatedAt: Date.now() }, true);
          } catch (err) {
            setToast({
              kind: 'error',
              message: err instanceof Error ? err.message : String(err),
            });
          } finally {
            markBusy(entry.id, false);
          }
        },
      });
    },
    [loadPreview, markBusy, refresh],
  );

  return (
    <main className="options">
      <header className="options__header">
        <h1 className="options__title">
          {APP_NAME}{' '}
          <span className="options__version">v{APP_VERSION}</span>
        </h1>
        <p className="options__subtitle">Manage saved workspaces</p>
      </header>

      {error && <p className="options__error">{error}</p>}
      {toast && (
        <div className={`options__toast options__toast--${toast.kind}`}>
          {toast.message}
        </div>
      )}

      {profiles === null ? (
        <p className="options__hint">Loading workspaces…</p>
      ) : profiles.length === 0 ? (
        <p className="options__hint">
          No workspaces yet. Open the extension popup and freeze one first.
        </p>
      ) : (
        <ul className="options__list">
          {profiles.map((p) => (
            <WorkspaceCard
              key={p.id}
              entry={p}
              expanded={expandedIds.has(p.id)}
              renaming={renamingId === p.id}
              busy={busyIds.has(p.id)}
              existingNames={profiles.map((x) => x.name)}
              preview={previewCache.get(p.id)?.profile ?? null}
              previewLoading={previewLoading.has(p.id)}
              previewError={previewError.get(p.id) ?? null}
              onToggleExpand={() => handleToggleExpand(p)}
              onStartRename={() => setRenamingId(p.id)}
              onCancelRename={() => setRenamingId(null)}
              onSubmitRename={(newName) => handleRename(p.id, newName)}
              onDelete={() => handleDelete(p)}
              onRemoveTab={(windowIndex, tabIndex, tab) =>
                handleRemoveTab(p, windowIndex, tabIndex, tab)
              }
            />
          ))}
        </ul>
      )}

      {confirm && (
        <ConfirmModal
          state={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const c = confirm;
            setConfirm(null);
            await c.onConfirm();
          }}
        />
      )}
    </main>
  );
}

function WorkspaceCard({
  entry,
  expanded,
  renaming,
  busy,
  existingNames,
  preview,
  previewLoading,
  previewError,
  onToggleExpand,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onDelete,
  onRemoveTab,
}: {
  entry: ProfileIndexEntry;
  expanded: boolean;
  renaming: boolean;
  busy: boolean;
  existingNames: string[];
  preview: Profile | null;
  previewLoading: boolean;
  previewError: string | null;
  onToggleExpand: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: (newName: string) => void;
  onDelete: () => void;
  onRemoveTab: (windowIndex: number, tabIndex: number, tab: SavedTab) => void;
}) {
  const drift = driftLabel(entry.tabCount, entry.tabsWithState);
  const now = Date.now();

  return (
    <li className="ws-card">
      <div className="ws-card__row">
        <button
          type="button"
          className="ws-card__chevron"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="ws-card__info">
          {renaming ? (
            <RenameForm
              initial={entry.name}
              existingNames={existingNames.filter(
                (n) => n.toLowerCase() !== entry.name.toLowerCase(),
              )}
              disabled={busy}
              onCancel={onCancelRename}
              onSubmit={onSubmitRename}
            />
          ) : (
            <>
              <span className="ws-card__name">{entry.name}</span>
              <span className="ws-card__meta">
                {entry.tabCount} tab{entry.tabCount === 1 ? '' : 's'}
                {drift && (
                  <>
                    {' · '}
                    <span
                      className={
                        entry.tabsWithState === 0
                          ? 'ws-card__drift ws-card__drift--none'
                          : 'ws-card__drift'
                      }
                    >
                      {drift}
                    </span>
                  </>
                )}
                {' · '}
                {formatRelativeTime(entry.updatedAt, now)}
              </span>
            </>
          )}
        </div>
        {!renaming && (
          <div className="ws-card__actions">
            <button
              type="button"
              className="ws-card__btn"
              onClick={onStartRename}
              disabled={busy}
            >
              Rename
            </button>
            <button
              type="button"
              className="ws-card__btn ws-card__btn--danger"
              onClick={onDelete}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="ws-card__preview">
          {previewLoading && !preview && (
            <p className="ws-card__preview-hint">Loading tabs…</p>
          )}
          {previewError && (
            <p className="ws-card__preview-error">{previewError}</p>
          )}
          {preview &&
            preview.windows.map((win, wi) => (
              <div key={wi} className="ws-card__window">
                {preview.windows.length > 1 && (
                  <p className="ws-card__window-label">
                    Window {wi + 1}
                    {win.focused && ' · focused'}
                  </p>
                )}
                <ul className="ws-card__tabs">
                  {win.tabs.map((t, ti) => {
                    const markers: string[] = [];
                    if (typeof t.scrollY === 'number' && t.scrollY >= 100) markers.push('scroll');
                    if (typeof t.anchorText === 'string' && t.anchorText.length > 0)
                      markers.push('anchor');
                    if (t.highlights && t.highlights.length > 0) markers.push('highlights');
                    if (t.frames && t.frames.length > 0) markers.push('iframe');
                    const hasState = tabHasState(t);
                    return (
                      <li key={`${t.url}-${ti}`} className="ws-card__tab">
                        <span className="ws-card__tab-title" title={t.title}>
                          {t.title || '(untitled)'}
                        </span>
                        <span className="ws-card__tab-host" title={t.url}>
                          {t.restricted ? 'restricted' : hostOf(t.url)}
                        </span>
                        {hasState && markers.length > 0 && (
                          <span
                            className="ws-card__tab-markers"
                            title={markers.join(' · ')}
                          >
                            {markers.map((m) => m[0]).join('')}
                          </span>
                        )}
                        <button
                          type="button"
                          className="ws-card__tab-remove"
                          onClick={() => onRemoveTab(wi, ti, t)}
                          disabled={busy}
                          aria-label={`Remove ${t.title || t.url}`}
                          title="Remove tab from workspace"
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </div>
      )}
    </li>
  );
}

function RenameForm({
  initial,
  existingNames,
  disabled,
  onCancel,
  onSubmit,
}: {
  initial: string;
  existingNames: string[];
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (newName: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return setLocalError('Name cannot be empty.');
    if (trimmed.length > 60) return setLocalError('Name must be 60 characters or fewer.');
    if (trimmed === initial) return onCancel();
    const lower = trimmed.toLowerCase();
    if (existingNames.some((n) => n.toLowerCase() === lower)) {
      return setLocalError('A workspace with this name already exists.');
    }
    setLocalError(null);
    onSubmit(trimmed);
  };

  return (
    <form
      className="ws-card__rename"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) submit();
      }}
    >
      <input
        ref={inputRef}
        type="text"
        className="ws-card__rename-input"
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
      <button
        type="submit"
        className="ws-card__btn ws-card__btn--primary"
        disabled={disabled}
      >
        Save
      </button>
      <button
        type="button"
        className="ws-card__btn"
        onClick={onCancel}
        disabled={disabled}
      >
        Cancel
      </button>
      {localError && <span className="ws-card__rename-error">{localError}</span>}
    </form>
  );
}

function ConfirmModal({
  state,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // Backdrop click cancels; clicks inside the panel are stopPropagation'd.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal__panel">
        <h2 className="modal__title">{state.title}</h2>
        <p className="modal__body">{state.body}</p>
        <div className="modal__actions">
          <button type="button" className="ws-card__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={
              state.destructive
                ? 'ws-card__btn ws-card__btn--danger-solid'
                : 'ws-card__btn ws-card__btn--primary'
            }
            onClick={onConfirm}
            autoFocus
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
