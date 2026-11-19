import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LazyBoundary } from './LazyBoundary';
import { legacyBoardHash } from './projectNav';
import './index.css';
import { startThemeSync } from './userDefaultsTheme';

// Excalidraw loads its fonts from here (bundled by vite.config.ts) instead of a CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';

// /dispatch (#731): in project mode (no workspace) it is the sidebar-less 세션 보드, loaded only there so the editor
// bundle does not carry it; in drawing mode the board lives in the shell, so old links go to `/#board…`.
const DispatchApp = lazy(() => import('./dispatch/index'));
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
const loading = <p className="p-6 text-sm text-muted-foreground">불러오는 중이에요…</p>;

if (!isDispatch) {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  root.render(loading);
  // Project mode: the server answers every editor URL with a 302 to /dispatch, so the board renders here.
  // Otherwise (or when /api/info cannot be read) the shell's board takes over, keeping the old hash's meaning.
  void fetch('/api/info')
    .then((r) => (r.ok ? (r.json() as Promise<{ mode?: string }>) : null))
    .catch(() => null)
    .then((info) => {
      if (!info) {
        // No redirect here: / would 302 back to /dispatch and loop forever.
        root.render(<p role="alert">정보를 불러오지 못했어요. 페이지를 새로 고쳐 주세요.</p>);
        return;
      }
      if (info.mode !== 'project') return location.replace(`/${legacyBoardHash(location.hash)}`);
      root.render(
        <StrictMode>
          <LazyBoundary>
            <Suspense fallback={loading}>
              <DispatchApp />
            </Suspense>
          </LazyBoundary>
        </StrictMode>,
      );
    });
}
