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
import type { EnergyShape, VibeTarget } from '@vibeamp/core';
import { ENERGY_SHAPE_LABELS, MIN_ANALYSED_TRACKS } from '@vibeamp/dj';
import { useDraggable } from './useDraggable.js';
import './vibe.css';

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
  /** Result of the last export or import, shown for a moment. */
  libraryNotice: string | null;
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
  libraryNotice,
}: VibePanelProps): React.JSX.Element {
  const ready = analysedCount >= MIN_ANALYSED_TRACKS;
  const { position, handleProps } = useDraggable(initialPosition);

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
      style={{ left: position.x, top: position.y }}
    >
      <div className="vibe-titlebar" {...handleProps}>
        <span>VIBEAMP</span>
        <span className="vibe-count">{analysedCount} analysed</span>
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
