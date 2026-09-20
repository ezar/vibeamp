/**
 * The application.
 *
 * Owns start-up order and nothing else: the shell is created, a folder can be
 * connected, the analysis runs in the background, and the queue controller keeps
 * music ahead of the listener. Everything interesting happens in the modules this
 * one calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { VibePanel } from '../ui/VibePanel.jsx';
import { useAppStore } from '../state/store.js';
import { createServices } from './services.js';
import type { Services } from './services.js';
import { connectFolder, readTagsInBackground } from './library.js';
import { createHost, isSupported } from '../webamp/host.js';
import type { WebampHost } from '../webamp/host.js';
import { PlaylistBridge } from '../webamp/playlist.js';
import { QueueController } from '../dj/queueController.js';
import { AnalysisRunner } from '../analysis/runner.js';
import { DebugPanel, useDebugPanel } from '../ui/DebugPanel.jsx';
import { OfflineNotice } from '../ui/OfflineNotice.jsx';
import { loadSkins, promptForSkin, rememberSkin, saveSkin } from '../skin/skins.js';
import type { LoadedSkins } from '../skin/skins.js';
import {
  downloadBlob,
  exportLibrary,
  exportToBlob,
  importLibrary,
  parseExport,
  promptForExport,
} from '../library/exchange.js';
import type { Track } from '@vibeamp/core';
import { defaultWorkerCount } from '../analysis/pool.js';
import './app.css';

export function App(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtime = useRef<{
    services: Services;
    host: WebampHost;
    bridge: PlaylistBridge;
    queue: QueueController;
    runner: AnalysisRunner | null;
    skins: LoadedSkins;
  } | null>(null);

  const [ready, setReady] = useState(false);
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const store = useAppStore();
  const debugOpen = useDebugPanel();

  useEffect(() => {
    if (!isSupported()) {
      useAppStore.getState().setError('This browser cannot run the audio features vibeamp needs.');
      return;
    }
    const container = containerRef.current;
    if (container === null || runtime.current !== null) return;

    let disposed = false;
    const services = createServices();

    void (async () => {
      // Asked for before anything is written: without persistent storage the browser
      // may evict IndexedDB under disk pressure, and hours of analysis go with it.
      await navigator.storage?.persist?.();

      // Skins the user brought, so they appear in the shell's own skin menu.
      const skins = await loadSkins(services.db);

      const host = await createHost({
        container,
        skins: skins.choices,
        initialSkin: skins.initial,
        openFolder: async () => {
          await handleConnectFolder();
          return [];
        },
        onTrackChange: (url) => {
          const current = runtime.current;
          if (current === undefined || current === null) return;
          void current.queue.onTrackChanged(url).then(async () => {
            const id = current.queue.playingTrackId;
            setPlayingTrack(
              id === null ? null : ((await current.services.repository.get(id)) ?? null),
            );
          });
        },
      });

      if (disposed) {
        skins.dispose();
        host.dispose();
        services.dispose();
        return;
      }

      const bridge = new PlaylistBridge(host.webamp);
      const queue = new QueueController(services.autoDj, bridge, services.repository, () => {
        const state = useAppStore.getState();
        return {
          target: state.vibeTarget,
          shape: state.energyShape,
          enabled: state.autoDjEnabled,
        };
      });

      runtime.current = { services, host, bridge, queue, runner: null, skins };
      host.media.setCrossfadeSeconds(useAppStore.getState().crossfadeSec);

      const counts = await services.repository.counts();
      useAppStore.getState().setAnalysedCount(counts.done);
      setReady(true);
    })();

    return () => {
      disposed = true;
      const current = runtime.current;
      current?.runner?.stop();
      current?.skins.dispose();
      current?.bridge.dispose();
      current?.host.dispose();
      current?.services.dispose();
      if (current === null) services.dispose();
      runtime.current = null;
    };
    // Started once, deliberately. The shell owns its own DOM and must not be torn
    // down and rebuilt as React state changes.
  }, []);

  /** Pick a folder, put it in the playlist, and start analysing it. */
  const handleConnectFolder = useCallback(async () => {
    const current = runtime.current;
    if (current === null) return;
    const state = useAppStore.getState();

    try {
      state.setScanning(true);
      const scanned = await connectFolder(current.services, (progress) =>
        state.setScanProgress(progress),
      );
      if (scanned === null || scanned.length === 0) return;

      state.setRootName(`${scanned.length} files`);

      // Playable immediately, before a single track has been analysed. The app has
      // to be useful in its first minute, not after its first hour.
      const tracks = await current.services.repository.pendingTracks(scanned.length);
      const byId = new Map(tracks.map((track) => [track.id, track]));
      current.bridge.replaceAll(
        scanned
          .map((entry) => {
            const track = byId.get(entry.track.id);
            return track === undefined ? null : { track, file: entry.file };
          })
          .filter(
            (entry): entry is { track: (typeof tracks)[number]; file: File } => entry !== null,
          ),
      );

      void readTagsInBackground(current.services, scanned);
      void startAnalysis(current);
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'the folder could not be read');
    } finally {
      state.setScanning(false);
      state.setScanProgress(null);
    }
  }, []);

  const startAnalysis = useCallback(async (current: NonNullable<typeof runtime.current>) => {
    current.runner?.stop();
    const runner = new AnalysisRunner({
      repository: current.services.repository,
      pool: current.services.pool,
      resolveFile: async (track) => current.services.files.resolve(track),
      stats: current.services.stats,
      onProgress: (progress) => {
        const state = useAppStore.getState();
        state.setAnalysis(progress);
        void current.services.repository
          .counts()
          .then((counts) => state.setAnalysedCount(counts.done));
      },
    });
    current.runner = runner;
    await runner.run();
  }, []);

  const handleToggleAutoDj = useCallback((enabled: boolean) => {
    useAppStore.getState().setAutoDj(enabled);
    if (enabled) void runtime.current?.queue.start();
  }, []);

  const handleCommit = useCallback(() => {
    void runtime.current?.queue.replan();
  }, []);

  /** Load a `.wsz` the user brings. The app ships none of its own. */
  const handleLoadSkin = useCallback(async () => {
    const current = runtime.current;
    if (current === null) return;

    const file = await promptForSkin();
    if (file === null) return;

    try {
      const skin = await saveSkin(current.services.db, file);
      const url = URL.createObjectURL(skin.data);
      current.host.webamp.setSkinFromUrl(url);
      await current.host.webamp.skinIsLoaded();
      await rememberSkin(current.services.db, skin.id);
      // It joins the shell's own skin menu on the next start, because
      // `availableSkins` is fixed when the shell is constructed.
      setLibraryNotice(`Skin "${skin.name}" loaded.`);
    } catch (error) {
      setLibraryNotice(error instanceof Error ? error.message : 'that skin could not be read');
    }
  }, []);

  const handleExport = useCallback(async () => {
    const current = runtime.current;
    if (current === null) return;

    const data = await exportLibrary(current.services.db);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(exportToBlob(data), `vibeamp-library-${stamp}.json`);
    setLibraryNotice(`Exported ${data.tracks.length} tracks.`);
  }, []);

  const handleImport = useCallback(async () => {
    const current = runtime.current;
    if (current === null) return;

    const file = await promptForExport();
    if (file === null) return;

    try {
      const data = parseExport(await file.text());
      const summary = await importLibrary(current.services.db, current.services.repository, data);
      const counts = await current.services.repository.counts();
      useAppStore.getState().setAnalysedCount(counts.done);
      setLibraryNotice(
        `Imported: ${summary.added} new, ${summary.improved} improved, ${summary.unchanged} unchanged.`,
      );
    } catch (error) {
      setLibraryNotice(error instanceof Error ? error.message : 'that file could not be imported');
    }
  }, []);

  return (
    <div className="app">
      <div className="app-shell" ref={containerRef} />

      {ready && (
        <VibePanel
          target={store.vibeTarget}
          shape={store.energyShape}
          analysedCount={store.analysedCount}
          autoDjEnabled={store.autoDjEnabled}
          status={statusLine(store)}
          progress={analysisFraction(store)}
          onChange={store.setVibe}
          onCommit={handleCommit}
          onShapeChange={store.setEnergyShape}
          onToggleAutoDj={handleToggleAutoDj}
          onLoadSkin={() => void handleLoadSkin()}
          onExport={() => void handleExport()}
          onImport={() => void handleImport()}
          libraryNotice={libraryNotice}
        />
      )}

      {ready && debugOpen && runtime.current !== null && (
        <DebugPanel
          stats={runtime.current.services.stats}
          track={playingTrack}
          analysedCount={store.analysedCount}
          workerCount={defaultWorkerCount()}
        />
      )}

      <OfflineNotice />

      {store.error !== null && (
        <p className="app-error" role="alert">
          {store.error}
        </p>
      )}
      {!ready && store.error === null && <p className="app-loading">Loading the shell…</p>}
    </div>
  );
}

type StoreState = ReturnType<typeof useAppStore.getState>;

function statusLine(state: StoreState): string | null {
  if (state.scanning) return `Scanning: ${state.scanProgress?.found ?? 0} files`;

  const analysis = state.analysis;
  if (analysis === null) return null;
  if (analysis.paused) return analysis.pausedReason;
  if (analysis.remaining === 0) return null;
  return `Analysing ${analysis.currentTitle ?? ''} — ${analysis.remaining} to go`;
}

function analysisFraction(state: StoreState): number | null {
  const analysis = state.analysis;
  if (analysis === null || analysis.remaining === 0) return null;
  const total = analysis.analysed + analysis.remaining;
  return total === 0 ? null : analysis.analysed / total;
}
