/**
 * The library window: what a collection looks like from the inside.
 *
 * Two things no streaming service can show you, for the same reason: both are read
 * off the audio, and a service has tags. The X-ray is where the collection sits in
 * tempo and in key. The duplicates are the copies of one recording that the tags
 * cannot find, because the tags are exactly what differs between them.
 *
 * Both are descriptive. Nothing here deletes a file, reorders a queue, or suggests
 * a collection ought to look some other way than it does.
 */

import { useMemo } from 'react';
import { HEALTH_TRACKS_SHOWN } from '@vibeamp/core';
import type {
  DuplicateGroup,
  HealthFinding,
  LibraryHealth,
  LibraryShape,
  Track,
} from '@vibeamp/core';
import { useDraggable } from './useDraggable.js';
import './library.css';

/** Radius of the wheel's outer edge, in the SVG's own units. */
const WHEEL_OUTER = 92;
/** Where the major ring meets the minor ring. */
const WHEEL_MIDDLE = 64;
/** The hole in the middle, which carries the count. */
const WHEEL_INNER = 34;

/** Groups listed before the rest are folded away. */
const GROUPS_SHOWN = 12;

export interface LibraryWindowProps {
  shape: LibraryShape | null;
  duplicates: readonly DuplicateGroup[] | null;
  health: LibraryHealth | null;
  /** True while the two are being computed, which is a pass over the library. */
  working: boolean;
  /** Where the window opens. Ignored on a phone, where it is a block in the page. */
  initialPosition: { x: number; y: number };
  narrow: boolean;
  onClose: () => void;
}

export function LibraryWindow({
  shape,
  duplicates,
  health,
  working,
  initialPosition,
  narrow,
  onClose,
}: LibraryWindowProps): React.JSX.Element {
  const { position, handleProps } = useDraggable(initialPosition, { enabled: !narrow });

  return (
    <div
      className="library-window"
      role="dialog"
      aria-label="Library"
      style={narrow ? undefined : { left: position.x, top: position.y }}
    >
      <div className="library-titlebar" {...handleProps}>
        <span className="library-title">LIBRARY</span>
        <button
          type="button"
          className="library-close"
          onClick={onClose}
          // The title bar captures the pointer to drag the window, and a captured
          // pointer never delivers a click to the button it went down on. Pressing
          // the close box is not the start of a drag, so it does not reach it.
          onPointerDown={(event) => event.stopPropagation()}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="library-body">
        {working && <p className="library-note">Reading the library…</p>}

        {shape !== null && (
          <>
            <Findings shape={shape} />
            <div className="library-column">
              <TempoChart shape={shape} />
              {duplicates !== null && <Duplicates groups={duplicates} />}
            </div>
            <div className="library-column">
              <KeyWheel shape={shape} />
              <Decades shape={shape} />
            </div>
          </>
        )}

        {health !== null && <Health health={health} />}

        {!working && shape !== null && shape.analysed === 0 && (
          <p className="library-note">
            Nothing analysed yet. Connect a folder and this fills in as the analysis runs.
          </p>
        )}
      </div>
    </div>
  );
}

function Findings({ shape }: { shape: LibraryShape }): React.JSX.Element | null {
  if (shape.findings.length === 0) return null;
  return (
    <ul className="library-findings">
      {shape.findings.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * Where the library sits in tempo.
 *
 * Bars rather than a curve: the buckets are counts, and a line between two counts
 * draws values that were never measured.
 */
function TempoChart({ shape }: { shape: LibraryShape }): React.JSX.Element | null {
  const peak = Math.max(...shape.tempo.map((bucket) => bucket.count));
  if (peak === 0) return null;

  return (
    <section className="library-section">
      <h3>tempo</h3>
      <div className="library-bars">
        {shape.tempo.map((bucket) => (
          <div
            key={bucket.fromBpm}
            className="library-bar"
            title={`${bucket.count} between ${bucket.fromBpm} and ${bucket.toBpm} BPM`}
          >
            <span style={{ height: `${Math.max(1, (bucket.count / peak) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="library-axis">
        {/* Only the ends and the middle are labelled: twelve numbers along a
            275px window is a grey smear. */}
        <span>{shape.tempo[0]?.fromBpm}</span>
        <span>{shape.tempo[Math.floor(shape.tempo.length / 2)]?.fromBpm}</span>
        <span>{shape.tempo.at(-1)?.toBpm}</span>
      </div>
    </section>
  );
}

/**
 * The Camelot wheel, with each position lit by how much of the library is in it.
 *
 * A bar chart of 24 keys would sort them by count and lose the one thing the
 * notation is for: neighbours on this wheel mix, and opposite sides do not. Drawn
 * as the wheel, a gap is visibly a gap in the collection's harmony rather than a
 * short bar somewhere in a list.
 */
function KeyWheel({ shape }: { shape: LibraryShape }): React.JSX.Element | null {
  const peak = Math.max(...shape.keys.map((slice) => slice.count));
  const counted = shape.keys.reduce((sum, slice) => sum + slice.count, 0);
  if (peak === 0) return null;

  return (
    <section className="library-section">
      <h3>key</h3>
      <svg
        className="library-wheel"
        viewBox="-100 -100 200 200"
        role="img"
        aria-label="Camelot wheel"
      >
        {shape.keys.map((slice) => {
          const inner = slice.letter === 'A' ? WHEEL_INNER : WHEEL_MIDDLE;
          const outer = slice.letter === 'A' ? WHEEL_MIDDLE : WHEEL_OUTER;
          return (
            <path
              key={slice.camelot}
              d={sectorPath(slice.number, inner, outer)}
              fill={lit(slice.count, peak)}
              stroke="#16161c"
              strokeWidth={1}
            >
              <title>{`${slice.camelot}: ${slice.count}`}</title>
            </path>
          );
        })}
        {shape.keys
          .filter((slice) => slice.letter === 'B')
          .map((slice) => {
            const { x, y } = polar(slice.number, (WHEEL_MIDDLE + WHEEL_OUTER) / 2);
            return (
              <text key={slice.camelot} x={x} y={y} className="library-wheel-label">
                {slice.number}
              </text>
            );
          })}
        <text x={0} y={2} className="library-wheel-centre">
          {counted}
        </text>
        <text x={0} y={14} className="library-wheel-centre library-wheel-centre--small">
          keys read
        </text>
      </svg>
      {/* The ring each mode is drawn in, because nothing else on the wheel says so. */}
      <p className="library-legend">inner ring minor (A) · outer ring major (B)</p>
    </section>
  );
}

function Decades({ shape }: { shape: LibraryShape }): React.JSX.Element | null {
  if (shape.decades.length === 0) return null;
  const peak = Math.max(...shape.decades.map((entry) => entry.count));

  return (
    <section className="library-section">
      <h3>years</h3>
      <ul className="library-decades">
        {shape.decades.map((entry) => (
          <li key={entry.decade}>
            <span className="library-decade-label">{entry.decade}s</span>
            <span className="library-decade-bar">
              <span style={{ width: `${Math.max(2, (entry.count / peak) * 100)}%` }} />
            </span>
            <span className="library-decade-count">{entry.count}</span>
          </li>
        ))}
      </ul>
      {/* Said once, here, rather than left for someone to wonder about: this is the
          one chart on this window that is not measured. */}
      <p className="library-legend">from the year tags, the only thing here that is not heard</p>
    </section>
  );
}

function Duplicates({ groups }: { groups: readonly DuplicateGroup[] }): React.JSX.Element {
  const shown = useMemo(() => groups.slice(0, GROUPS_SHOWN), [groups]);

  return (
    <section className="library-section">
      <h3>duplicates</h3>
      {groups.length === 0 ? (
        <p className="library-note">
          No two files here hold the same recording — by sound, not by name.
        </p>
      ) : (
        <>
          <ul className="library-groups">
            {shown.map((group) => (
              <li key={group.tracks[0]?.id ?? ''}>
                <span
                  className={`library-verdict library-verdict--${group.verdict}`}
                  title={
                    group.verdict === 'different-master'
                      ? 'Same performance, mastered differently: a remaster or a reissue'
                      : 'Same performance, same mastering'
                  }
                >
                  {group.verdict === 'different-master' ? 'remaster' : 'copy'}
                </span>
                <ol>
                  {group.tracks.map((track) => (
                    <li key={track.id} title={track.relPath}>
                      {label(track)}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
          {groups.length > shown.length && (
            <p className="library-note">and {groups.length - shown.length} more.</p>
          )}
          {/* The reason this window has no delete button, stated where the
              temptation is. */}
          <p className="library-legend">
            Listed, never deleted: a radio edit, an instrumental or another take can land here too.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * What is wrong with the files themselves.
 *
 * Spans both columns because it is a list of names, and because it is the part of
 * this window that asks for something to be done rather than merely looked at.
 *
 * The blind spots are shown whether or not anything was found, and especially when
 * nothing was: "no problems" from a check that cannot see transcodes would be read
 * as "no transcodes".
 */
function Health({ health }: { health: LibraryHealth }): React.JSX.Element {
  return (
    <section className="library-section library-section--wide">
      <h3>condition</h3>
      {health.findings.length === 0 ? (
        <p className="library-note">
          {health.checked === 0
            ? 'Nothing checked yet.'
            : `Nothing wrong with any of the ${health.checked} files checked.`}
        </p>
      ) : (
        <>
          <p className="library-note">
            {health.affected} of {health.total} files have something worth a look.
          </p>
          <ul className="library-issues">
            {health.findings.map((finding) => (
              <Issue key={finding.issue} finding={finding} />
            ))}
          </ul>
        </>
      )}
      {/* Said before the findings, because it changes what they mean: a count of
          problems is only about the files that were looked at. */}
      {health.awaitingReanalysis > 0 && (
        <p className="library-note">
          {health.awaitingReanalysis} more still carry descriptors from an earlier version of the
          analysis. They are checked once it reaches them.
        </p>
      )}
      <ul className="library-blind">
        {health.blindSpots.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

/** The labels, kept out of the data so `health.ts` holds no interface text. */
const ISSUE_LABELS: Record<HealthFinding['issue'], string> = {
  undecodable: 'will not play',
  failed: 'analysis failed',
  silent: 'empty',
  'fake-stereo': 'fake stereo',
  'abrupt-end': 'ends abruptly',
  clipped: 'clipped',
};

function Issue({ finding }: { finding: HealthFinding }): React.JSX.Element {
  const shown = finding.tracks.slice(0, HEALTH_TRACKS_SHOWN);
  return (
    <li>
      <span className={`library-issue library-issue--${finding.issue}`}>
        {ISSUE_LABELS[finding.issue]}
      </span>
      <span className="library-issue-count">{finding.tracks.length}</span>
      <p>{finding.summary}</p>
      <ol>
        {shown.map((track) => (
          <li key={track.id} title={track.relPath}>
            {label(track)}
          </li>
        ))}
      </ol>
      {finding.tracks.length > shown.length && (
        <p className="library-note">and {finding.tracks.length - shown.length} more.</p>
      )}
    </li>
  );
}

/** The file, named the way the person would recognise it. */
function label(track: Track): string {
  const title = track.meta.title ?? track.fileName.replace(/\.[^.]+$/, '');
  const artist = track.meta.artist;
  const kbps =
    track.durationSec !== null && track.durationSec > 0
      ? `${Math.round((track.size * 8) / track.durationSec / 1000)}k`
      : '';
  return `${artist === null ? '' : `${artist} — `}${title}${kbps === '' ? '' : ` · ${kbps}`}`;
}

/** Green at the library's busiest key, the panel's own dark at nothing. */
function lit(count: number, peak: number): string {
  if (count === 0) return '#20202a';
  // Square root rather than linear: one key with a third of the library in it
  // would otherwise leave every other position looking empty.
  const share = Math.sqrt(count / peak);
  return `hsl(120 65% ${Math.round(14 + share * 34)}%)`;
}

/** A point on the wheel: position 1 at the top, going clockwise. */
function polar(number: number, radius: number): { x: number; y: number } {
  const angle = ((number - 1) / 12) * Math.PI * 2 - Math.PI / 2 + Math.PI / 12;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/** One annular sector of the wheel, as an SVG path. */
function sectorPath(number: number, inner: number, outer: number): string {
  const from = ((number - 1) / 12) * Math.PI * 2 - Math.PI / 2;
  const to = (number / 12) * Math.PI * 2 - Math.PI / 2;
  const point = (radius: number, angle: number): string =>
    `${(radius * Math.cos(angle)).toFixed(2)} ${(radius * Math.sin(angle)).toFixed(2)}`;

  return [
    `M ${point(outer, from)}`,
    `A ${outer} ${outer} 0 0 1 ${point(outer, to)}`,
    `L ${point(inner, to)}`,
    `A ${inner} ${inner} 0 0 0 ${point(inner, from)}`,
    'Z',
  ].join(' ');
}
