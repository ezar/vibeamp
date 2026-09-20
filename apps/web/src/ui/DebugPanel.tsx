/**
 * The debug panel.
 *
 * Hidden behind a key combination, because it is for whoever is tuning the engine
 * rather than for whoever is listening. It answers the three questions that decide
 * whether a bad queue is the scoring's fault or the descriptors': where the
 * analysis time goes, what failed, and what the playing track actually measured.
 */

import { useEffect, useState } from 'react';
import type { Track } from '@vibeamp/core';
import type { DebugSnapshot, DebugStats } from '../debug/stats.js';
import './debug.css';

/** How often the readout refreshes, in milliseconds. */
const REFRESH_MS = 1000;

export interface DebugPanelProps {
  stats: DebugStats;
  /** The track playing, so its descriptors can be shown. */
  track: Track | null;
  analysedCount: number;
  workerCount: number;
}

/**
 * Toggle the panel with Ctrl+Shift+D. Returns whether it is open.
 *
 * Listened for in the **capture** phase, and swallowed. Winamp binds Ctrl+D to
 * double size and the shell matches it without looking at Shift, so the obvious
 * listener opens this panel and doubles the player at the same time. Capturing on
 * `window` runs before the shell's own handler on the document, and
 * `stopImmediatePropagation` is what stops the key reaching it at all.
 */
export function useDebugPanel(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'd') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  return open;
}

export function DebugPanel({
  stats,
  track,
  analysedCount,
  workerCount,
}: DebugPanelProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<DebugSnapshot>(() => stats.snapshot());

  useEffect(() => {
    const timer = window.setInterval(() => setSnapshot(stats.snapshot()), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [stats]);

  const analysis = track?.analysis ?? null;

  return (
    <div className="debug-panel" role="region" aria-label="Debug">
      <h2>vibeamp debug</h2>

      <table>
        <tbody>
          <Row label="analysed" value={String(analysedCount)} />
          <Row label="workers" value={String(workerCount)} />
          <Row label="decode mean" value={ms(snapshot.decodeMeanMs)} />
          <Row label="per track" value={ms(snapshot.trackMeanMs)} />
        </tbody>
      </table>

      <h3>Stages</h3>
      {snapshot.stages.length === 0 ? (
        <p className="debug-empty">nothing analysed yet</p>
      ) : (
        <table>
          <tbody>
            {snapshot.stages.map((stage) => (
              <Row
                key={stage.stage}
                label={`${stage.stage} (${stage.samples})`}
                value={ms(stage.meanMs)}
              />
            ))}
          </tbody>
        </table>
      )}

      <h3>Now playing</h3>
      {analysis === null ? (
        <p className="debug-empty">
          {track === null ? 'nothing playing' : 'this track has no analysis yet'}
        </p>
      ) : (
        <table>
          <tbody>
            <Row label="title" value={track?.meta.title ?? track?.fileName ?? ''} />
            <Row
              label="bpm"
              value={`${analysis.bpm.toFixed(1)} (${analysis.bpmConfidence.toFixed(2)})`}
            />
            <Row
              label="key"
              value={`${analysis.key.root} ${analysis.key.scale} · ${analysis.key.camelot} (${analysis.key.strength.toFixed(2)})`}
            />
            <Row label="loudness" value={`${analysis.loudnessDb.toFixed(1)} dBFS`} />
            <Row label="energy" value={unit(analysis.energy)} />
            <Row label="brightness" value={unit(analysis.brightness)} />
            <Row label="compression" value={unit(analysis.compression)} />
            <Row label="danceability" value={unit(analysis.danceability)} />
          </tbody>
        </table>
      )}
      {analysis?.provisional === true && (
        <p className="debug-provisional">
          provisional: fewer than 50 analysed, so these are fixed ranges rather than percentiles
        </p>
      )}

      <h3>Failures</h3>
      {snapshot.failures.length === 0 ? (
        <p className="debug-empty">none</p>
      ) : (
        <table>
          <tbody>
            {snapshot.failures.map((failure) => (
              <tr key={`${failure.trackId}-${failure.at}`} className="debug-failure">
                <td>{failure.code}</td>
                <td>{failure.message.slice(0, 40)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="debug-hint">ctrl+shift+d to close</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <tr>
      <td>{label}</td>
      <td>{value}</td>
    </tr>
  );
}

function ms(value: number): string {
  return value === 0 ? '—' : `${Math.round(value)} ms`;
}

function unit(value: number): string {
  return value.toFixed(3);
}
