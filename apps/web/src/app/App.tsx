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
import type { FolderSource } from './library.js';
import { folderFromDrop } from '../library/drop.js';
import { buildM3u, matchEntry, parseM3u } from '../library/m3u.js';
import { createHost, isSupported } from '../webamp/host.js';
import type { WebampHost } from '../webamp/host.js';
import { PlaylistBridge } from '../webamp/playlist.js';
import { vibeWindowPosition } from '../webamp/layout.js';
import { CrossfadeScheduler } from '../audio/CrossfadeScheduler.js';
import { QueueController } from '../dj/queueController.js';
import type { PlannedEntry } from '../dj/queueController.js';
import { AnalysisRunner } from '../analysis/runner.js';
import { DebugPanel, useDebugPanel } from '../ui/DebugPanel.jsx';
import { OfflineNotice } from '../ui/OfflineNotice.jsx';
import { loadSkins, promptForSkin, rememberSkin, saveSkin } from '../skin/skins.js';
import type { LoadedSkins } from '../skin/skins.js';
import type { Track as WebampTrack } from 'webamp';
import {
  downloadBlob,
  exportLibrary,
  exportToBlob,
  importLibrary,
  parseExport,
  promptForExport,
} from '../library/exchange.js';
import type { Track } from '@vibeamp/core';
import type { VibePreset } from '@vibeamp/dj';
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
    crossfade: CrossfadeScheduler;
  } | null>(null);

  const [ready, setReady] = useState(false);
  const [hasLibrary, setHasLibrary] = useState(false);
  // Where the vibe window opens. Measured from the shell once it has rendered, so
  // the two sit together instead of at opposite corners of an empty page.
  const [panelPosition, setPanelPosition] = useState({ x: 16, y: 16 });
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const [upcoming, setUpcoming] = useState<readonly PlannedEntry[]>([]);
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
        onDropFolder: async (event) => {
          const folder = await folderFromDrop(event.dataTransfer);
          if (folder === null) {
            setLibraryNotice('Drop a folder, not single files: a track needs a folder to scan.');
            return false;
          }
          await handleConnectFolder(folder);
          return true;
        },
        onLoadPlaylist: () => handleLoadPlaylist(),
        onSavePlaylist: (tracks) => handleSavePlaylist(tracks),
        onAddUrl: () =>
          setLibraryNotice('vibeamp plays your own files. There is nothing to fetch from a URL.'),
        onUnsupported: (what) => setLibraryNotice(`${what} is not part of vibeamp.`),
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
      const queue = new QueueController(
        services.autoDj,
        bridge,
        services.repository,
        () => {
          const state = useAppStore.getState();
          return {
            target: state.vibeTarget,
            shape: state.energyShape,
            enabled: state.autoDjEnabled,
          };
        },
        (next) => setUpcoming(next),
      );

      // Advancing early is what makes the cross-fade apply to ordinary playback:
      // the shell moves on while there is still audio to fade out of, instead of
      // after `ended`, when the element already reports itself paused.
      const crossfade = new CrossfadeScheduler({
        media: host.media,
        advance: () => host.webamp.nextTrack(),
        hasNext: () => bridge.remainingAfter(host.media.currentUrl()) > 0,
      });
      crossfade.start();

      runtime.current = { services, host, bridge, queue, runner: null, skins, crossfade };
      host.media.setCrossfadeSeconds(useAppStore.getState().crossfadeSec);

      const counts = await services.repository.counts();
      useAppStore.getState().setAnalysedCount(counts.done);
      setPanelPosition(besideTheShell());
      setReady(true);
    })();

    return () => {
      disposed = true;
      const current = runtime.current;
      current?.runner?.stop();
      current?.crossfade.stop();
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
  const handleConnectFolder = useCallback(async (source?: FolderSource) => {
    const current = runtime.current;
    if (current === null) return;
    const state = useAppStore.getState();

    try {
      state.setScanning(true);
      const scanned = await connectFolder(
        current.services,
        (progress) => state.setScanProgress(progress),
        source,
      );
      if (scanned === null || scanned.length === 0) return;

      state.setRootName(`${scanned.length} files`);
      setHasLibrary(true);
      setLibraryNotice(null);

      // Playable immediately, before a single track has been analysed. The app has
      // to be useful in its first minute, not after its first hour.
      //
      // Every track the scan found, whatever its status. Asking only for pending
      // ones leaves the playlist empty whenever a folder was already analysed on a
      // previous visit, which is the common case on every visit after the first.
      const tracks = await current.services.repository.getMany(
        scanned.map((entry) => entry.track.id),
      );
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
    // Switching it off drops the plan but not what the shell already holds: those
    // tracks will play whatever happens, and the queue shown says so.
    if (enabled) void runtime.current?.queue.start();
    else void runtime.current?.queue.replan();
  }, []);

  const handleCommit = useCallback(() => {
    void runtime.current?.queue.replan();
  }, []);

  /**
   * Set every slider and the curve at once, and replan.
   *
   * A preset is a starting point, not a mode: nothing here is remembered, and the
   * next slider move is an ordinary move from wherever it left things.
   */
  const handleApplyPreset = useCallback((preset: VibePreset) => {
    const state = useAppStore.getState();
    state.setVibe(preset.target);
    state.setEnergyShape(preset.shape);
    void runtime.current?.queue.replan();
  }, []);

  /**
   * Read an `.m3u` into the playlist.
   *
   * Entries are matched against the library rather than opened as paths: a browser
   * cannot open a path, and a playlist written on another machine names none that
   * exist here anyway. Whatever resolves is loaded and the rest is reported, which
   * is more use than refusing the file.
   */
  const handleLoadPlaylist = useCallback(async (): Promise<WebampTrack[] | null> => {
    const current = runtime.current;
    if (current === null) return null;

    const file = await promptForFile('.m3u,.m3u8,audio/x-mpegurl');
    if (file === null) return null;

    const entries = parseM3u(await file.text());
    const tracks = await current.services.repository.allTracks();
    const byRelPath = new Map(tracks.map((track) => [track.relPath, track]));
    const byFileName = new Map(tracks.map((track) => [track.fileName, track]));

    const queued = [];
    let missing = 0;
    for (const entry of entries) {
      const track = matchEntry(entry, byRelPath, byFileName);
      const resolved = track === null ? null : current.services.files.resolve(track);
      if (track === null || resolved === null) {
        missing++;
        continue;
      }
      queued.push({ track, file: resolved });
    }

    if (queued.length === 0) {
      setLibraryNotice(
        entries.length === 0
          ? 'That playlist is empty.'
          : 'None of those tracks are in the connected folder.',
      );
      return null;
    }

    setLibraryNotice(
      missing === 0
        ? `Loaded ${queued.length} tracks.`
        : `Loaded ${queued.length} tracks; ${missing} are not in the connected folder.`,
    );
    return current.bridge.register(queued);
  }, []);

  /** Write the shell's playlist out as an `.m3u`, with the paths from our library. */
  const handleSavePlaylist = useCallback(async (tracks: readonly WebampTrack[]): Promise<void> => {
    const current = runtime.current;
    if (current === null) return;

    const urls = tracks.map((track) => ('url' in track ? track.url : ''));
    const ids = current.bridge.trackIdsFor(urls);
    const known = await current.services.repository.getMany(
      ids.filter((id): id is string => id !== null),
    );
    const byId = new Map(known.map((track) => [track.id, track]));

    const rows = ids
      .map((id) => (id === null ? null : byId.get(id)))
      .filter((track): track is NonNullable<typeof track> => track !== undefined && track !== null)
      .map((track) => ({
        path: track.relPath,
        durationSec: track.durationSec,
        title:
          track.meta.artist === null
            ? (track.meta.title ?? track.fileName)
            : `${track.meta.artist} - ${track.meta.title ?? track.fileName}`,
      }));

    if (rows.length === 0) {
      setLibraryNotice('There is nothing in the playlist to save.');
      return;
    }

    downloadBlob(new Blob([buildM3u(rows)], { type: 'audio/x-mpegurl' }), 'vibeamp.m3u');
    setLibraryNotice(`Saved ${rows.length} tracks.`);
  }, []);

  const handleCrossfadeChange = useCallback((seconds: number) => {
    useAppStore.getState().setCrossfade(seconds);
    runtime.current?.host.media.setCrossfadeSeconds(seconds);
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
          hasLibrary={hasLibrary}
          initialPosition={panelPosition}
          onOpenFolder={() => void handleConnectFolder()}
          autoDjEnabled={store.autoDjEnabled}
          status={statusLine(store)}
          progress={analysisFraction(store)}
          onChange={store.setVibe}
          onCommit={handleCommit}
          crossfadeSec={store.crossfadeSec}
          onCrossfadeChange={handleCrossfadeChange}
          onShapeChange={store.setEnergyShape}
          onToggleAutoDj={handleToggleAutoDj}
          onLoadSkin={() => void handleLoadSkin()}
          onExport={() => void handleExport()}
          onImport={() => void handleImport()}
          onToggleMilkdrop={() => runtime.current?.host.toggleMilkdrop()}
          nowPlaying={playingTrack}
          upcoming={upcoming}
          onApplyPreset={handleApplyPreset}
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

/**
 * Where to open the vibe window: just left of the shell, aligned with its top.
 *
 * Webamp centres itself on the container and mounts at the end of `<body>`, so the
 * only reliable way to sit beside it is to measure it once it is there. Falls back
 * to the top-left corner on a screen too narrow to fit both.
 */
function besideTheShell(): { x: number; y: number } {
  // Webamp centres its own windows, so where the panel goes is only known once the
  // shell has rendered and the main window can be measured.
  const main = document.querySelector('#main-window');
  return vibeWindowPosition(main === null ? null : main.getBoundingClientRect());
}

/** Ask the user for one file of a given kind. Resolves null if they dismiss it. */
function promptForFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
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
