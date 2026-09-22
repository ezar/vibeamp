/**
 * The vibe sliders, and the way into the app.
 *
 * Two jobs. The first is the demonstration moment of the product: five vertical
 * sliders in the Winamp idiom, and letting one go reorders what is coming next
 * without interrupting what is playing.
 *
 * The second is more basic and was missing. Connecting a folder is the one thing
 * that has to happen before anything else works, and the shell only offers it three
 * levels down its own menu — so this window leads with it until there is a library.
 *
 * Re-planning happens on release, not on every pixel of movement. Planning reads the
 * whole analysed library, and doing that on `input` turns one drag into a few
 * hundred passes over it.
 */

import { useCallback } from 'react';
import type { EnergyShape, Track, VibeTarget } from '@vibeamp/core';
import {
  ENERGY_SHAPE_LABELS,
  MIN_ANALYSED_TRACKS,
  VIBE_PRESETS,
  explainTransition,
} from '@vibeamp/dj';
import type { VibePreset } from '@vibeamp/dj';
import { useDraggable } from './useDraggable.js';
import './vibe.css';

/**
 * How much of the queue to show.
 *
 * Four. The plan is twenty deep, but this window is 277px wide and sits beside a
 * player, not in place of one — and past the fourth track a slider move will have
 * rewritten the list anyway.
 */
const QUEUE_PREVIEW = 4;

/** Cross-fade lengths the window offers, in seconds. */
const CROSSFADE_CHOICES = [0, 2, 4, 6, 8, 12] as const;

/** The sliders, in the order they appear. */
const SLIDERS: ReadonlyArray<{
  key: keyof VibeTarget;
  label: string;
  /** What each end means, so the short labels do not have to be guessed at. */
  title: string;
}> = [
  { key: 'energy', label: 'energy', title: 'calm to intense' },
  { key: 'brightness', label: 'bright', title: 'dark to bright' },
  { key: 'danceability', label: 'dance', title: 'contemplative to rhythmic' },
  { key: 'familiarity', label: 'known', title: 'forgotten to most played' },
  { key: 'coherence', label: 'cohere', title: 'variety to matched tempo and key' },
];

export interface VibePanelProps {
  target: VibeTarget;
  shape: EnergyShape;
  analysedCount: number;
  /** Whether a folder has been connected in this session. */
  hasLibrary: boolean;
  autoDjEnabled: boolean;
  /** Progress line, or null when there is nothing to say. */
  status: string | null;
  /** 0..1, or null when there is no analysis running. */
  progress: number | null;
  /** Where the window starts, normally just left of the shell. */
  initialPosition: { x: number; y: number };
  onOpenFolder: () => void;
  onChange: (patch: Partial<VibeTarget>) => void;
  /** Called on release, when the queue should be replanned. */
  onCommit: () => void;
  /** Cross-fade length in seconds. 0 plays tracks back to back. */
  crossfadeSec: number;
  onCrossfadeChange: (seconds: number) => void;
  onShapeChange: (shape: EnergyShape) => void;
  onToggleAutoDj: (enabled: boolean) => void;
  /** Load a `.wsz` the user brings. The app ships no skins of its own. */
  onLoadSkin: () => void;
  onExport: () => void;
  onImport: () => void;
  /** Open or close MilkDrop. The shell's own entry for it is three levels down. */
  onToggleMilkdrop: () => void;
  /** Copy a link that carries these slider positions and nothing else. */
  onCopyVibeLink: () => void;
  /** Open the window that shows what the collection looks like from the inside. */
  onOpenLibrary: () => void;
  /** Write the planned set out as one file that both plays and reads. */
  onExportSet: () => void;
  /** What is playing, for the transition into the first queued track. */
  nowPlaying: Track | null;
  /** What the auto-DJ has lined up, nearest first. Empty when it is switched off. */
  upcoming: readonly UpcomingTrack[];
  /** Set every slider and the curve at once. */
  onApplyPreset: (preset: VibePreset) => void;
  /**
   * A phone-sized viewport: the panel is a column under the shell rather than a
   * window beside it, and dragging it would fight the page scroll.
   */
  narrow: boolean;
  /** Result of the last export or import, shown for a moment. */
  libraryNotice: string | null;
}

/** One entry of the queue, as the window needs it. */
export interface UpcomingTrack {
  track: Track;
  /** What the energy curve asked for at this position, 0..1. */
  targetEnergy: number;
}

export function VibePanel({
  target,
  shape,
  analysedCount,
  hasLibrary,
  autoDjEnabled,
  status,
  progress,
  initialPosition,
  onOpenFolder,
  onChange,
  onCommit,
  crossfadeSec,
  onCrossfadeChange,
  onShapeChange,
  onToggleAutoDj,
  onLoadSkin,
  onExport,
  onImport,
  onToggleMilkdrop,
  onCopyVibeLink,
  onOpenLibrary,
  onExportSet,
  nowPlaying,
  upcoming,
  onApplyPreset,
  narrow,
  libraryNotice,
}: VibePanelProps): React.JSX.Element {
  const ready = analysedCount >= MIN_ANALYSED_TRACKS;
  const { position, handleProps } = useDraggable(initialPosition, { enabled: !narrow });
  const queue = upcoming.slice(0, QUEUE_PREVIEW);
  // Only the imminent move is explained. The ones after it are planned from a
  // target the listener is still moving, so describing them would be a promise the
  // next slider release breaks.
  const first = queue[0];
  const transition =
    nowPlaying !== null && first !== undefined ? explainTransition(nowPlaying, first.track) : null;

  const handleInput = useCallback(
    (key: keyof VibeTarget, value: string) => {
      onChange({ [key]: Number(value) / 100 } as Partial<VibeTarget>);
    },
    [onChange],
  );

  return (
    <div
      className="vibe-window"
      role="group"
      aria-label="Vibe"
      // On a phone this is a block in the page, placed by the stylesheet; setting
      // a left and a top here would be a position nothing reads.
      style={narrow ? undefined : { left: position.x, top: position.y }}
    >
      <div className="vibe-titlebar" {...handleProps}>
        <span className="vibe-title">
          VIBEAMP
          {/* Nothing analysed is not worth a number; it is the state the hero
              button above already explains. */}
          {analysedCount > 0 && <span className="vibe-count">{analysedCount} analysed</span>}
        </span>
      </div>

      <div className="vibe-body">
        {!hasLibrary && (
          <div className="vibe-hero">
            <button
              type="button"
              className="vibe-button vibe-button--primary"
              onClick={onOpenFolder}
            >
              OPEN FOLDER
            </button>
            <p>Or drop a folder on the player. Nothing leaves your machine.</p>
          </div>
        )}

        <div className="vibe-sliders">
          {SLIDERS.map(({ key, label, title }) => (
            <div className="vibe-slider" key={key}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(target[key] * 100)}
                title={title}
                aria-label={`${label}: ${title}`}
                disabled={!ready}
                onChange={(event) => handleInput(key, event.target.value)}
                // Re-plan when the slider is let go, by pointer or by keyboard.
                onPointerUp={onCommit}
                onKeyUp={onCommit}
              />
              <label>{label}</label>
            </div>
          ))}
        </div>

        <div className="vibe-row vibe-row--presets">
          <label>vibe</label>
          <div className="vibe-actions">
            {VIBE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="vibe-button"
                disabled={!ready}
                title={preset.title}
                onClick={() => onApplyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="vibe-row">
          <label htmlFor="vibe-shape">curve</label>
          <select
            id="vibe-shape"
            value={shape}
            disabled={!ready}
            onChange={(event) => {
              onShapeChange(event.target.value as EnergyShape);
              onCommit();
            }}
          >
            {Object.entries(ENERGY_SHAPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`vibe-button vibe-button--autodj${autoDjEnabled ? ' vibe-button--on' : ''}`}
            disabled={!ready}
            title={
              autoDjEnabled
                ? 'The queue is planned from what is playing'
                : 'Hand the playlist over to the auto-DJ'
            }
            onClick={() => onToggleAutoDj(!autoDjEnabled)}
          >
            AUTO-DJ
          </button>
        </div>

        {queue.length > 0 && (
          <div className="vibe-queue">
            <div className="vibe-queue-head">
              <span>next up</span>
              {transition !== null && (
                <span title="the move into the first track">{transition.summary}</span>
              )}
            </div>
            <ol>
              {queue.map((entry, index) => (
                <li key={`${entry.track.id}-${index}`}>
                  <span className="vibe-queue-title">{titleOf(entry.track)}</span>
                  <span className="vibe-queue-meta">{metaOf(entry.track)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="vibe-row vibe-row--secondary">
          <label htmlFor="vibe-fade">fade</label>
          <select
            id="vibe-fade"
            className="vibe-select--narrow"
            value={crossfadeSec}
            title="Seconds of cross-fade between tracks"
            onChange={(event) => onCrossfadeChange(Number(event.target.value))}
          >
            {CROSSFADE_CHOICES.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds === 0 ? 'off' : `${seconds}s`}
              </option>
            ))}
          </select>

          <div className="vibe-actions">
            <button
              type="button"
              className="vibe-button"
              disabled={!ready}
              onClick={onCopyVibeLink}
              title="Copy a link to these slider positions. It carries no music, and it works on somebody else's library."
            >
              Link
            </button>
            <button
              type="button"
              className="vibe-button"
              disabled={!autoDjEnabled}
              onClick={onExportSet}
              title="Save the planned set: one .m3u that plays anywhere and reads as a set sheet, each track with the move into it"
            >
              Set
            </button>
            <button
              type="button"
              className="vibe-button"
              onClick={onOpenLibrary}
              // What this needs is analysed tracks, not a folder connected in
              // this session. On every visit after the first the library is
              // already in IndexedDB and no folder has been reconnected, which
              // left the button dead beside a panel saying "142 analysed".
              disabled={analysedCount === 0}
              title="What this collection looks like in tempo and key, and which files hold the same recording"
            >
              X-ray
            </button>
            <button
              type="button"
              className="vibe-button"
              onClick={onToggleMilkdrop}
              title="Open or close the MilkDrop visualiser"
            >
              Milkdrop
            </button>
            {hasLibrary && (
              <button type="button" className="vibe-button" onClick={onOpenFolder}>
                Folder
              </button>
            )}
            <button
              type="button"
              className="vibe-button"
              onClick={onLoadSkin}
              title="Load a .wsz Winamp skin"
            >
              Skin
            </button>
            <button
              type="button"
              className="vibe-button"
              onClick={onExport}
              title="Save the index, descriptors included"
            >
              Export
            </button>
            <button
              type="button"
              className="vibe-button"
              onClick={onImport}
              title="Merge an exported index"
            >
              Import
            </button>
          </div>
        </div>

        <div className="vibe-status">
          {libraryNotice !== null && <p>{libraryNotice}</p>}
          {status !== null && <p>{status}</p>}
          {hasLibrary && !ready && status === null && (
            <p className="vibe-warning">
              {MIN_ANALYSED_TRACKS - analysedCount} more analysed and the auto-DJ wakes up.
            </p>
          )}
          {progress !== null && (
            <div
              className="vibe-progress"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
            >
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** What to call a track: its tag, or the file name with the extension dropped. */
function titleOf(track: Track): string {
  return track.meta.title ?? track.fileName.replace(/\.[^.]+$/, '');
}

/** Tempo and key, the two numbers a transition turns on. */
function metaOf(track: Track): string {
  const analysis = track.analysis;
  if (analysis === null) return '';
  const bpm = analysis.bpm > 0 ? `${Math.round(analysis.bpm)}` : '--';
  return `${bpm} · ${analysis.key.camelot}`;
}
