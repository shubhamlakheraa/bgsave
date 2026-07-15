import { APP_NAME, APP_VERSION } from '../shared/constants';

export function App() {
  return (
    <main className="popup">
      <header className="popup__header">
        <h1 className="popup__title">{APP_NAME}</h1>
        <span className="popup__version">v{APP_VERSION}</span>
      </header>
      <p className="popup__tagline">Freeze workspaces. Restore your brain.</p>
    </main>
  );
}
