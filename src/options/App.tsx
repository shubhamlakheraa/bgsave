import { APP_NAME, APP_VERSION } from '../shared/constants';

export function App() {
  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1>
        {APP_NAME} <small style={{ color: '#888' }}>v{APP_VERSION}</small>
      </h1>
      <p>Options page — profile management lands in Task 13.</p>
    </main>
  );
}
