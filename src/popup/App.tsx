import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../shared/constants';
import { sendToBackground } from '../shared/messaging';
import { formatRelativeTime } from '../shared/time';
import { isRestrictedUrl } from '../background/capture';
import type { ProfileIndexEntry } from '../shared/types';

type ConnStatus = 'pending' | 'connected' | 'disconnected';
type Mode = 'list' | 'freezing' | 'saving';

interface TabRow {
  id: number;
  title: string;
  url: string;
  host: string;
  favIconUrl?: string;
  restricted: boolean;
  pinned: boolean;
}

export function App() {
  const [profiles, setProfiles] = useState<ProfileIndexEntry[] | null>(null);
  const [conn, setConn] = useState<ConnStatus>('pending');
  const [mode, setMode] = useState<Mode>('list');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="popup">
      <header className="popup__header">
        <h1 className="popup__title">{APP_NAME}</h1>
        {mode === 'list' && (
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

      {mode === 'list' && <ProfileList profiles={profiles} />}

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

function ProfileList({ profiles }: { profiles: ProfileIndexEntry[] | null }) {
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
  return (
    <ul className="popup__list">
      {profiles.map((p) => (
        <li key={p.id} className="popup__row">
          <span className="popup__row-name">{p.name}</span>
          <span className="popup__row-meta">
            {p.tabCount} tab{p.tabCount === 1 ? '' : 's'} · {formatRelativeTime(p.updatedAt, now)}
          </span>
        </li>
      ))}
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
