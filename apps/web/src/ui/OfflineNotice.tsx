/**
 * The service worker's two pieces of news.
 *
 * "Ready offline" matters here more than in most apps: vibeamp's whole claim is
 * that it works with no network, and the only moment the user can be told that it
 * is now true is when the cache has filled.
 *
 * Updates are offered rather than applied. The worker precaches the entire app, so
 * activating a new one under a running session can serve a new page against an old
 * chunk — and the session it would interrupt is someone listening to music.
 */

import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import './offline.css';

export function OfflineNotice(): React.JSX.Element | null {
  const [offlineReady, setOfflineReady] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      onOfflineReady: () => setOfflineReady(true),
      onNeedRefresh: () => setNeedsRefresh(true),
    });
    // Stored in a function, or React calls it as a state updater and reloads the
    // page the moment the effect runs.
    setUpdate(() => async () => updateSW(true));
  }, []);

  useEffect(() => {
    if (!offlineReady) return;
    const timer = window.setTimeout(() => setOfflineReady(false), 6000);
    return () => window.clearTimeout(timer);
  }, [offlineReady]);

  if (needsRefresh) {
    return (
      <div className="offline-notice" role="status">
        <span>A new version is ready.</span>
        <button type="button" onClick={() => void update?.()}>
          Reload
        </button>
        <button type="button" onClick={() => setNeedsRefresh(false)}>
          Later
        </button>
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div className="offline-notice" role="status">
        <span>Ready to run offline.</span>
      </div>
    );
  }

  return null;
}
