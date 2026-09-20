/**
 * The vibe sliders.
 *
 * The demonstration moment of the whole product: five vertical sliders that look
 * like they came off a 1997 equaliser, and moving one reorders what is coming next
 * without interrupting what is playing.
 *
 * Re-planning happens on release, not on every pixel of movement. Planning a queue
 * reads the whole analysed library, and doing that on `input` turns a slider drag
 * into a few hundred passes over it.
 */

import { useCallback } from 'react';
import { useDraggable } from './useDraggable.js';
import type { EnergyShape, VibeTarget } from '@vibeamp/core';
import { ENERGY_SHAPE_LABELS } from '@vibeamp/dj';
import { MIN_ANALYSED_TRACKS } from '@vibeamp/dj';
import './vibe.css';

/** The sliders, in the order they appear. */
const SLIDERS: ReadonlyArray<{
  key: keyof VibeTarget;
  label: string;
  /** What each end means, so the labels do not have to be guessed at. */
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
  autoDjEnabled: boolean;
  /** Analysis progress line, or null when nothing is being analysed. */
  status: string | null;
  /** 0..1, or null when there is no analysis running. */
  progress: number | null;
  onChange: (patch: Partial<VibeTarget>) => void;
  /** Called on release, when the queue should be replanned. */
  onCommit: () => void;
  onShapeChange: (shape: EnergyShape) => void;
  onToggleAutoDj: (enabled: boolean) => void;
}

export function VibePanel({
  target,
  shape,
  analysedCount,
  autoDjEnabled,
  status,
  progress,
  onChange,
  onCommit,
  onShapeChange,
  onToggleAutoDj,
}: VibePanelProps): React.JSX.Element {
  const ready = analysedCount >= MIN_ANALYSED_TRACKS;
  const { position, handleProps } = useDraggable({ x: 16, y: 16 });

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
        <span className="vibe-readout">{analysedCount} analysed</span>
      </div>

      <div className="vibe-body">
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

          <button type="button" disabled={!ready} onClick={() => onToggleAutoDj(!autoDjEnabled)}>
            {autoDjEnabled ? 'Auto-DJ on' : 'Auto-DJ off'}
          </button>
        </div>

        <div className="vibe-status">
          {!ready && (
            <p className="vibe-warning">
              Auto-DJ needs {MIN_ANALYSED_TRACKS} analysed tracks. Too few, and it produces queues
              that are obviously wrong.
            </p>
          )}
          {status !== null && <p>{status}</p>}
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
