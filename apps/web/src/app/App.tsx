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
import { LibraryWindow } from '../ui/LibraryWindow.jsx';
import type { DeepScanState } from '../ui/LibraryWindow.jsx';
import { deepScan } from '../analysis/deepScan.js';
import { useAppStore } from '../state/store.js';
import { createServices } from './services.js';
import type { Services } from './services.js';
import { connectFolder, readTagsInBackground } from './library.js';
import type { FolderSource } from './library.js';
import { folderFromDrop } from '../library/drop.js';
import { buildM3u, matchEntry, parseM3u } from '../library/m3u.js';
import { ENERGY_SHAPE_LABELS, setSheet } from '@vibeamp/dj';
import { createHost, isSupported } from '../webamp/host.js';
import type { WebampHost } from '../webamp/host.js';
import { PlaylistBridge } from '../webamp/playlist.js';
import { libraryWindowPosition, vibeWindowPosition } from '../webamp/layout.js';
import { isNarrowNow, useIsNarrow } from '../ui/useIsNarrow.js';
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
import {
  referenceLoudnessDb,
  commonGround,
  compareShapes,
  decodeShapeCode,
  encodeShapeCode,
  findDuplicates,
  libraryHealth,
  libraryShape,
  matchWantList,
  proposeNames,
} from '@vibeamp/core';
import { parseWantList } from '../library/wantList.js';
import type {
  DuplicateGroup,
  LibraryHealth,
  LibraryShape,
  ProposedName,
  ShapeComparison,
  Track,
  WantReport,
} from '@vibeamp/core';
import type { VibePreset } from '@vibeamp/dj';
import { vibeFromUrl, vibeLink } from './vibeLink.js';
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
  // The second decode, which is never started on its own: it costs a full-rate
  // decode of every file, which is the memory the pipeline exists to avoid.
  const [deep, setDeep] = useState<DeepScanState | null>(null);
  const deepStop = useRef(false);

  const [ready, setReady] = useState(false);
  const [hasLibrary, setHasLibrary] = useState(false);
  // Where the vibe window opens. Measured from the shell once it has rendered, so
  // the two sit together instead of at opposite corners of an empty page.
  const [panelPosition, setPanelPosition] = useState({ x: 16, y: 16 });
  // The library window opens on the shell's other side, measured the same way.
  const [libraryPosition, setLibraryPosition] = useState({ x: 16, y: 16 });
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const [upcoming, setUpcoming] = useState<readonly PlannedEntry[]>([]);
  // The X-ray window. Its two answers are computed on demand rather than kept in
  // step with the library: both are a pass over every track, and nobody is looking
  // at them while the analysis is still running.
  const [xray, setXray] = useState<{
    shape: LibraryShape | null;
    duplicates: readonly DuplicateGroup[] | null;
    health: LibraryHealth | null;
    names: readonly ProposedName[] | null;
    namedCount: number;
    working: boolean;
  } | null>(null);
  // The last list somebody matched. Kept beside the X-ray rather than inside it
  // because it survives a re-measure: nobody wants to paste the list again.
  const [want, setWant] = useState<WantReport | null>(null);
  // A collection compared against a code somebody sent, and the records of this
  // library that sit in the ground the two share.
  const [comparison, setComparison] = useState<{
    report: ShapeComparison;
    common: readonly Track[];
  } | null>(null);
  const narrow = useIsNarrow();
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
        // Read once: `windowLayout` is a construction option, so a viewport that
        // changes later keeps the windows it opened with. Rotating a phone should
        // not close the equaliser somebody deliberately opened.
        narrow: isNarrowNow(),
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
      host.media.setBeatAlign(useAppStore.getState().beatAlign);
      host.media.setLevelling(useAppStore.getState().levelling);
      // The engine works in URLs and knows nothing about tracks; the bridge is
      // where a track and its URL meet, so that is where the grids and the levels
      // live.
      host.media.setPlaybackLookup((url) => bridge.playbackForUrl(url));
      bridge.setLoudnessReference(referenceLoudnessDb(await services.repository.statistics()));

      const counts = await services.repository.counts();
      useAppStore.getState().setAnalysedCount(counts.done);
      if (!isNarrowNow()) {
        setPanelPosition(besideTheShell());
        setLibraryPosition(rightOfTheShell());
      }
      // Said once, because a queue that is already planned to somebody else's
      // taste should say where that came from.
      if (vibeFromUrl(window.location.href) !== null) {
        setLibraryNotice('Sliders set from a shared link. Move any of them to make it yours.');
      }
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

  /**
   * Keep the panel beside the shell.
   *
   * Webamp re-centres its windows when the browser window changes size, so where
   * the panel belongs is only knowable by measuring, and only after that has
   * settled — hence the next frame rather than the handler itself.
   *
   * A phone gets none of this: there the panel is an ordinary block under the
   * shell and the stylesheet places it.
   */
  useEffect(() => {
    if (!ready || narrow) return undefined;

    let frame = 0;
    const place = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setPanelPosition(besideTheShell());
        setLibraryPosition(rightOfTheShell());
      });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('orientationchange', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
    };
  }, [ready, narrow]);

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

    // The library now sits somewhere different, so the level everything is played
    // at moves with it. Read once at the end of a run rather than on every track:
    // the reference is a common-mode shift, and moving it mid-run would change the
    // volume of what is playing for no audible benefit.
    current.bridge.setLoudnessReference(
      referenceLoudnessDb(await current.services.repository.statistics()),
    );
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
  /**
   * Copy a link carrying these slider positions.
   *
   * The clipboard needs a secure context, which a file:// page and some embedded
   * browsers are not. Failing there is not a reason to lose the link, so it goes
   * into the notice where it can be selected by hand.
   */
  const handleCopyVibeLink = useCallback(async () => {
    const state = useAppStore.getState();
    const link = vibeLink(window.location.href, {
      target: state.vibeTarget,
      shape: state.energyShape,
    });

    try {
      await navigator.clipboard.writeText(link);
      setLibraryNotice('Vibe link copied. It carries the sliders, not the music.');
    } catch {
      setLibraryNotice(link);
    }
  }, []);

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

  /**
   * Open the library window and measure the library.
   *
   * Opened first, computed second. All three answers are a pass over every track,
   * and on a large collection that is long enough to notice — so the window appears
   * saying what it is doing rather than the button appearing to do nothing.
   */
  const handleOpenLibrary = useCallback(async () => {
    const current = runtime.current;
    if (current === null) return;

    setXray({
      shape: null,
      duplicates: null,
      health: null,
      names: null,
      namedCount: 0,
      working: true,
    });
    const tracks = await current.services.repository.allTracks();
    // Yielded to once more so the window paints before the passes begin.
    await new Promise((resolve) => setTimeout(resolve, 0));
    setXray({
      shape: libraryShape(tracks),
      duplicates: findDuplicates(tracks),
      health: libraryHealth(tracks),
      names: proposeNames(tracks),
      namedCount: tracks.filter((track) => (track.given ?? null) !== null).length,
      working: false,
    });
  }, []);

  /**
   * Store the names worked out for the files that have none.
   *
   * Into this library's index, never into the file: see `repository.applyNames`.
   * The list is re-measured afterwards, so the accepted rows leave the window and
   * the want list can immediately find the files they named.
   */
  const handleAcceptNames = useCallback(async () => {
    const current = runtime.current;
    if (current === null) return;
    const proposals = xray?.names ?? [];
    if (proposals.length === 0) return;

    const changed = await current.services.repository.applyNames(proposals);
    setLibraryNotice(`Named ${changed} ${changed === 1 ? 'file' : 'files'}.`);
    await handleOpenLibrary();
  }, [xray?.names, handleOpenLibrary]);

  /** Drop every name this library gave itself. The tags were never touched. */
  const handleForgetNames = useCallback(async () => {
    const current = runtime.current;
    if (current === null) return;
    const forgotten = await current.services.repository.forgetNames();
    setLibraryNotice(`Forgot ${forgotten} ${forgotten === 1 ? 'name' : 'names'}.`);
    await handleOpenLibrary();
  }, [handleOpenLibrary]);

  /**
   * Match a list of names against the library.
   *
   * The proposals go in with it, so a file whose only claim to a name came from its
   * sound is findable by a list that names it — which is the whole reason this is
   * in a player that listens to its own files.
   */
  const handleMatchWantList = useCallback(
    async (text: string) => {
      const current = runtime.current;
      if (current === null) return;

      const entries = parseWantList(text);
      if (entries.length === 0) {
        setWant(null);
        setLibraryNotice('Nothing in that list that looks like a track.');
        return;
      }

      const tracks = await current.services.repository.allTracks();
      setWant(
        matchWantList(entries, tracks, {
          names: xray?.names ?? proposeNames(tracks),
          shape: xray?.shape ?? libraryShape(tracks),
        }),
      );
    },
    [xray?.names, xray?.shape],
  );

  /** Copy this library's shape: two histograms and a count, and nothing else. */
  const handleCopyShapeCode = useCallback(async () => {
    const shape = xray?.shape ?? null;
    if (shape === null) return;
    const code = encodeShapeCode(shape);
    try {
      await navigator.clipboard.writeText(code);
      setLibraryNotice('Shape copied. It says what kind of collection this is, not what is in it.');
    } catch {
      // The field on screen already holds it, so a refused clipboard is not a
      // failure worth a message of its own.
      setLibraryNotice('Copy it from the field: this browser would not take it.');
    }
  }, [xray?.shape]);

  /**
   * Compare this library against a code somebody sent.
   *
   * The comparison is of two shapes and says so. What it can turn into something
   * to play is the last part: the records here that sit in the region both codes
   * agree on.
   */
  const handleCompareShape = useCallback(
    async (code: string) => {
      const current = runtime.current;
      const shape = xray?.shape ?? null;
      if (current === null || shape === null) return;

      const theirs = decodeShapeCode(code);
      if (theirs === null) {
        setComparison(null);
        setLibraryNotice('That is not a shape code this version wrote.');
        return;
      }

      const report = compareShapes(shape, theirs);
      const tracks = await current.services.repository.allAnalysed();
      setComparison({ report, common: commonGround(tracks, report) });
    },
    [xray?.shape],
  );

  /** Save the shared set as a playlist that plays anywhere. */
  const handleSaveCommon = useCallback(() => {
    const common = comparison?.common ?? [];
    if (common.length === 0) return;

    const text = buildM3u(
      common.map((track) => ({
        path: track.relPath,
        durationSec: track.durationSec,
        title: fullTitle(track),
        note: null,
      })),
      {
        header: [
          `vibeamp · ${common.length} tracks from the ground two collections share`,
          'Chosen by measured tempo and key, from this library only.',
        ],
      },
    );
    downloadBlob(new Blob([text], { type: 'audio/x-mpegurl' }), 'vibeamp-common-ground.m3u');
    setLibraryNotice(`Saved ${common.length} tracks.`);
  }, [comparison?.common]);

  /**
   * Write the plan out as one file that both plays and reads.
   *
   * The queue lives in memory and dies with the tab, taking the part that took the
   * work — the order — with it. The notes ride in `#` comments, which every reader
   * of the format skips, so this is a playlist in Winamp and a set sheet in a text
   * editor without being two files.
   */
  const handleExportSet = useCallback(() => {
    const current = runtime.current;
    if (current === null) return;

    const rows = setSheet(
      playingTrack,
      current.queue.upcoming().map((entry) => entry.track),
    );
    if (rows.length === 0) {
      setLibraryNotice('Turn the auto-DJ on and there will be a set to save.');
      return;
    }

    const state = useAppStore.getState();
    const sliders = Object.entries(state.vibeTarget)
      .map(([name, value]) => `${name} ${Math.round(value * 100)}`)
      .join(' · ');

    const text = buildM3u(
      rows.map((row) => ({
        path: row.track.relPath,
        durationSec: row.track.durationSec,
        title: fullTitle(row.track),
        // An arrow rather than a dash: this is the move into the track below it,
        // and a reader scanning the file should not have to work that out.
        note: row.transition === null ? null : `↓ ${row.transition.summary}`,
      })),
      {
        header: [
          `vibeamp set · ${new Date().toISOString().slice(0, 10)} · ${rows.length} tracks`,
          `${ENERGY_SHAPE_LABELS[state.energyShape]} · ${sliders}`,
          'Plays as a playlist. The arrows are the moves between tracks.',
        ],
      },
    );

    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([text], { type: 'audio/x-mpegurl' }), `vibeamp-set-${stamp}.m3u`);
    setLibraryNotice(`Saved a set of ${rows.length} tracks.`);
  }, [playingTrack]);

  /**
   * Decode every reachable file a second time, at its own rate.
   *
   * Only the files this session can still open: a folder that is not connected is
   * not a fault of the file, and there is nothing to decode without one.
   */
  const handleDeepScan = useCallback(async () => {
    const current = runtime.current;
    if (current === null) return;

    const tracks = await current.services.repository.allAnalysed();
    const byId = new Map(tracks.map((track) => [track.id, track]));
    deepStop.current = false;
    setDeep({ running: true, done: 0, total: tracks.length, currentTitle: null, readings: [] });

    const readings = await deepScan(tracks, (track) => current.services.files.resolve(track), {
      onProgress: (progress) =>
        setDeep((previous) => ({
          running: true,
          done: progress.done,
          total: progress.total,
          currentTitle: progress.currentTitle,
          readings: previous?.readings ?? [],
        })),
      shouldStop: () => deepStop.current,
    });

    setDeep({
      running: false,
      done: readings.length,
      total: readings.length,
      currentTitle: null,
      readings: readings.flatMap((reading) => {
        const track = byId.get(reading.trackId);
        return track === undefined ? [] : [{ ...reading, track }];
      }),
    });
  }, []);

  const handleCrossfadeChange = useCallback((seconds: number) => {
    useAppStore.getState().setCrossfade(seconds);
    runtime.current?.host.media.setCrossfadeSeconds(seconds);
  }, []);

  const handleBeatAlignChange = useCallback((enabled: boolean) => {
    useAppStore.getState().setBeatAlign(enabled);
    runtime.current?.host.media.setBeatAlign(enabled);
  }, []);

  const handleLevellingChange = useCallback((enabled: boolean) => {
    useAppStore.getState().setLevelling(enabled);
    runtime.current?.host.media.setLevelling(enabled);
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
          beatAlign={store.beatAlign}
          onBeatAlignChange={handleBeatAlignChange}
          levelling={store.levelling}
          onLevellingChange={handleLevellingChange}
          onShapeChange={store.setEnergyShape}
          onToggleAutoDj={handleToggleAutoDj}
          onLoadSkin={() => void handleLoadSkin()}
          onExport={() => void handleExport()}
          onImport={() => void handleImport()}
          onToggleMilkdrop={() => runtime.current?.host.toggleMilkdrop()}
          onCopyVibeLink={() => void handleCopyVibeLink()}
          onOpenLibrary={() => void handleOpenLibrary()}
          onExportSet={handleExportSet}
          nowPlaying={playingTrack}
          upcoming={upcoming}
          onApplyPreset={handleApplyPreset}
          narrow={narrow}
          libraryNotice={libraryNotice}
        />
      )}

      {ready && xray !== null && (
        <LibraryWindow
          shape={xray.shape}
          duplicates={xray.duplicates}
          health={xray.health}
          deep={deep}
          onDeepScan={() => void handleDeepScan()}
          names={xray.names}
          namedCount={xray.namedCount}
          onAcceptNames={() => void handleAcceptNames()}
          onForgetNames={() => void handleForgetNames()}
          want={want}
          onMatchWantList={(text) => void handleMatchWantList(text)}
          shapeCode={xray.shape === null ? null : encodeShapeCode(xray.shape)}
          comparison={comparison?.report ?? null}
          common={comparison?.common ?? []}
          onCopyShapeCode={() => void handleCopyShapeCode()}
          onCompareShape={(code) => void handleCompareShape(code)}
          onSaveCommon={handleSaveCommon}
          working={xray.working}
          initialPosition={libraryPosition}
          narrow={narrow}
          onClose={() => setXray(null)}
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
/**
 * Where to put the vibe panel, measured rather than assumed.
 *
 * Webamp centres its own windows inside the node it rendered into, so this is only
 * knowable once the shell exists.
 */
function besideTheShell(): { x: number; y: number } {
  const main = document.querySelector('#main-window');
  return vibeWindowPosition(main === null ? null : main.getBoundingClientRect());
}

/** The same, for the library window, which opens on the shell's other side. */
function rightOfTheShell(): { x: number; y: number } {
  const main = document.querySelector('#main-window');
  return libraryWindowPosition(
    main === null ? null : main.getBoundingClientRect(),
    window.innerWidth,
  );
}

/** Artist and title where there is one, for a line somebody will read. */
function fullTitle(track: Track): string {
  const title = track.meta.title ?? track.fileName.replace(/\.[^.]+$/, '');
  return track.meta.artist === null ? title : `${track.meta.artist} - ${title}`;
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
