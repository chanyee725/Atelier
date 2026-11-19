import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { legacyBoardHash } from './projectNav';
import './index.css';
import { startThemeSync } from './userDefaultsTheme';

// Excalidraw loads its fonts from here (bundled by vite.config.ts) instead of a CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';

// /dispatch (#731, #773): the 세션 보드 lives in the app shell in every mode, so old links go to `/#board…`.
const isDispatch = /^\/dispatch(\/|$)/.test(window.location.pathname);

// Dev-only check hook (stripped from builds): `?runFixture=<blockId>` shows the fixture run over that block,
// `&runBlocked` with the test step blocked. The block's code should be FIXTURE_CODE.
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const id = q.get('runFixture');
  if (id) void import('./run/fixture').then(async (f) => (await import('./run/runStore')).setRunSteps(id, q.has('runBlocked') ? f.FIXTURE_BLOCKED : f.FIXTURE_STEPS));
}

// The theme follows ~/.dispatch/drawing.json and is written back to it (E555).
startThemeSync();

const root = createRoot(document.getElementById('root')!);

if (isDispatch) location.replace(`/${legacyBoardHash(location.hash)}`);
else
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
