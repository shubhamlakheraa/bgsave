import { APP_NAME, APP_VERSION } from '../shared/constants';

export function App() {
  return (
    <main className="welcome">
      <header className="welcome__header">
        <h1 className="welcome__title">Welcome to {APP_NAME}</h1>
        <p className="welcome__tagline">
          Freeze developer workspaces — tabs, scroll positions, highlights — and restore
          them exactly as you left them.
        </p>
      </header>

      <section className="welcome__steps" aria-label="Getting started">
        <article className="welcome__step">
          <span className="welcome__step-num">1</span>
          <h2 className="welcome__step-title">Freeze a window</h2>
          <p className="welcome__step-body">
            Click the <strong>{APP_NAME}</strong> toolbar icon and hit{' '}
            <strong>+ Freeze</strong> to save every tab in the current window under a
            name.
          </p>
        </article>

        <article className="welcome__step">
          <span className="welcome__step-num">2</span>
          <h2 className="welcome__step-title">Restore it later</h2>
          <p className="welcome__step-body">
            Open the popup, find the workspace in the list, and click{' '}
            <strong>Restore</strong>. Tabs reopen with scroll positions and highlights
            reapplied.
          </p>
        </article>

        <article className="welcome__step">
          <span className="welcome__step-num">3</span>
          <h2 className="welcome__step-title">Append tabs on the fly</h2>
          <p className="welcome__step-body">
            Right-click any page and pick <strong>Add to workspace</strong> to drop a
            single tab into an existing frozen workspace.
          </p>
        </article>
      </section>

      <aside className="welcome__tip" role="note">
        <strong>Tip:</strong> pin the {APP_NAME} icon to your Chrome toolbar (puzzle
        menu → pin icon) so it&rsquo;s one click away.
      </aside>

      <div className="welcome__actions">
        <button
          type="button"
          className="welcome__btn welcome__btn--primary"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          Open manage page
        </button>
        <button
          type="button"
          className="welcome__btn"
          onClick={() => window.close()}
        >
          Got it — close this tab
        </button>
      </div>

      <footer className="welcome__footer">
        {APP_NAME} v{APP_VERSION}
      </footer>
    </main>
  );
}
