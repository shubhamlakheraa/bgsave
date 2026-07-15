import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../shared/constants';
import { sendToBackground } from '../shared/messaging';
import { formatRelativeTime } from '../shared/time';
import type { ProfileIndexEntry } from '../shared/types';

type ConnStatus = 'pending' | 'connected' | 'disconnected';
type Mode = 'list' | 'naming' | 'saving';

export function App() {
  const [profiles, setProfiles] = useState<ProfileIndexEntry[] | null>(null);
  const [conn, setConn] = useState<ConnStatus>('pending');
  const [mode, setMode] = useState<Mode>('list');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await sendToBackground({ type: 'LIST_PROFILES' });
      // Newest-first — the index doesn't guarantee order.
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
    async (name: string) => {
      setMode('saving');
      setError(null);
      try {
        await sendToBackground({ type: 'FREEZE_WORKSPACE', name });
        await refresh();
        setMode('list');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setMode('naming');
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
              setMode('naming');
            }}
            disabled={conn !== 'connected'}
          >
            + Freeze
          </button>
        )}
      </header>

      {(mode === 'naming' || mode === 'saving') && (
        <NameForm
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

function NameForm({
  disabled,
  existingNames,
  onCancel,
  onSubmit,
}: {
  disabled: boolean;
  existingNames: string[];
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
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
    setLocalError(null);
    onSubmit(trimmed);
  };

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
        value={value}
        maxLength={60}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          if (localError) setLocalError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
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
