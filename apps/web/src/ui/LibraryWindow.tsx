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

import { useMemo, useState } from 'react';
import { HEALTH_TRACKS_SHOWN, cutoffVerdict, describeCutoff } from '@vibeamp/core';
import type {
  ArtistNote,
  CutoffReading,
  CutoffVerdict,
  DuplicateGroup,
  HealthFinding,
  LibraryHealth,
  LibraryShape,
  ProposedName,
  SeguePair,
  ShapeComparison,
  Track,
  WantReport,
  WantRow,
} from '@vibeamp/core';
import { DEFAULT_JOURNEY_STEPS } from '@vibeamp/dj';
import type { JourneyStep } from '@vibeamp/dj';
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
  /** The second-decode readings, once somebody has asked for them. */
  deep: DeepScanState | null;
  /** Start the second decode. Null when there is nothing reachable to read. */
  onDeepScan: (() => void) | null;
  /** The pairs of tracks that run together. Null before the pass has run. */
  segues: readonly SeguePair[] | null;
  /** Names worked out for the files that have none. Null before the pass has run. */
  names: readonly ProposedName[] | null;
  /** How many files already carry a name this library gave them. */
  namedCount: number;
  /** Write every proposal into the index. Never into the files. */
  onAcceptNames: () => void;
  /** Drop every name this library gave itself. */
  onForgetNames: () => void;
  /** The last list somebody matched against the library. */
  want: WantReport | null;
  /** Match a pasted or opened list. */
  onMatchWantList: (text: string) => void;
  /** This library's own shape code, to send to somebody. */
  shapeCode: string | null;
  /** The last comparison against a code somebody sent. */
  comparison: ShapeComparison | null;
  /** Records of this library that sit in the ground the two collections share. */
  common: readonly Track[];
  onCopyShapeCode: () => void;
  onCompareShape: (code: string) => void;
  onSaveCommon: () => void;
  /** Every analysed track, for the journey pickers. */
  catalogue: readonly CatalogueEntry[];
  /** What is playing, so a journey can start from where you are. */
  nowPlayingId: string | null;
  /** The last route planned. Empty when the planner could not find one. */
  journey: readonly JourneyStep[] | null;
  journeyPlanning: boolean;
  onPlanJourney: (fromId: string, toId: string, steps: number) => void;
  onPlayJourney: () => void;
  onSaveJourney: () => void;
  /** True while the two are being computed, which is a pass over the library. */
  working: boolean;
  /** Where the window opens. Ignored on a phone, where it is a block in the page. */
  initialPosition: { x: number; y: number };
  narrow: boolean;
  onClose: () => void;
}

/** One track, as the journey pickers need it. */
export interface CatalogueEntry {
  id: string;
  /** What to call it, and what somebody types to find it. */
  label: string;
}

/** One reading, already joined to the track it belongs to. */
export interface DeepReading extends CutoffReading {
  track: Track;
}

/** What the deep scan is doing, or what it found. */
export interface DeepScanState {
  running: boolean;
  done: number;
  total: number;
  currentTitle: string | null;
  readings: readonly DeepReading[];
}

export function LibraryWindow({
  shape,
  duplicates,
  health,
  deep,
  onDeepScan,
  segues,
  names,
  namedCount,
  onAcceptNames,
  onForgetNames,
  want,
  onMatchWantList,
  shapeCode,
  comparison,
  common,
  onCopyShapeCode,
  onCompareShape,
  onSaveCommon,
  catalogue,
  nowPlayingId,
  journey,
  journeyPlanning,
  onPlanJourney,
  onPlayJourney,
  onSaveJourney,
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

        {health !== null && <Health health={health} deep={deep} onDeepScan={onDeepScan} />}

        {segues !== null && <Segues pairs={segues} />}

        {names !== null && (
          <Names
            names={names}
            namedCount={namedCount}
            onAccept={onAcceptNames}
            onForget={onForgetNames}
          />
        )}

        {shape !== null && <Wanted report={want} onMatch={onMatchWantList} />}

        {shape !== null && (
          <Journey
            catalogue={catalogue}
            nowPlayingId={nowPlayingId}
            route={journey}
            planning={journeyPlanning}
            onPlan={onPlanJourney}
            onPlay={onPlayJourney}
            onSave={onSaveJourney}
          />
        )}

        {shapeCode !== null && (
          <Compare
            mine={shapeCode}
            comparison={comparison}
            common={common}
            onCopyCode={onCopyShapeCode}
            onCompare={onCompareShape}
            onSaveCommon={onSaveCommon}
          />
        )}

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
      {/* Beside the chart rather than in the findings above it: a hole is only
          legible next to the bars it is a hole in. */}
      {shape.gaps.tempo.length > 0 && (
        <p className="library-legend">
          Nothing between{' '}
          {shape.gaps.tempo
            .slice(0, 2)
            .map((gap) => `${gap.fromBpm} and ${gap.toBpm}`)
            .join(', nor ')}{' '}
          BPM — a set crossing there has to jump.
        </p>
      )}
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
      <Islands gaps={shape.gaps} />
    </section>
  );
}

/**
 * Whether the wheel joins up.
 *
 * Said only when it does not. One island is the ordinary, healthy case and
 * announcing it would be noise; two or more is a collection that cannot be mixed
 * from any track to any other, which is worth a sentence — and the codes that
 * would join them are the rare thing in this window that names something to do.
 */
function Islands({ gaps }: { gaps: LibraryShape['gaps'] }): React.JSX.Element | null {
  if (gaps.islands.length < 2) return null;

  return (
    <p className="library-legend library-legend--warn">
      These keys fall into {gaps.islands.length} groups that cannot reach each other on the wheel
      {gaps.bridges.length === 0
        ? '.'
        : `, so no set crosses between them. A track in ${gaps.bridges.slice(0, 3).join(', ')} would join two of them.`}
    </p>
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
function Health({
  health,
  deep,
  onDeepScan,
}: {
  health: LibraryHealth;
  deep: DeepScanState | null;
  onDeepScan: (() => void) | null;
}): React.JSX.Element {
  return (
    <section className="library-section library-section--wide library-section--condition">
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
      <DeepScan state={deep} onStart={onDeepScan} />

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

/** What each verdict is called, and the line that explains it. */
const VERDICT_TEXT: Record<CutoffVerdict, { label: string; detail: string }> = {
  transcode: {
    label: 'transcoded',
    detail:
      'Carrying a big file’s worth of bytes and a small one’s worth of bandwidth. Made from something worse; the bytes were paid for twice.',
  },
  lossy: {
    label: 'lossy source',
    detail: 'A modest encode, honestly carried by a file of about the right size.',
  },
  high: { label: 'good encode', detail: 'The ceiling of a high-bitrate lossy encode.' },
  full: { label: 'full band', detail: 'Its whole top end: lossless, or an encode that kept it.' },
};

/** The order the groups are shown in: what is worth acting on, first. */
const VERDICT_ORDER: CutoffVerdict[] = ['transcode', 'lossy', 'high', 'full'];

/**
 * The second decode: the one check the ordinary analysis cannot make.
 *
 * Offered rather than run. A full-rate decode of every track is the memory and
 * time cost the whole pipeline is built to avoid, so this is a button, it says
 * what it is about to do, and it can be stopped.
 *
 * What it reports is not the cutoff but the *disagreement*: a 128 kbps file that
 * cuts off at 16 kHz is being exactly what it says it is, and only a file carrying
 * far more bytes than bandwidth has something wrong with it.
 */
function DeepScan({
  state,
  onStart,
}: {
  state: DeepScanState | null;
  onStart: (() => void) | null;
}): React.JSX.Element | null {
  const groups = useMemo(() => {
    const byVerdict = new Map<CutoffVerdict, DeepReading[]>();
    for (const reading of state?.readings ?? []) {
      const verdict = cutoffVerdict(reading);
      if (verdict === null) continue;
      const list = byVerdict.get(verdict) ?? [];
      list.push(reading);
      byVerdict.set(verdict, list);
    }
    for (const list of byVerdict.values()) {
      list.sort((a, b) => (a.cutoffHz ?? 0) - (b.cutoffHz ?? 0));
    }
    return byVerdict;
  }, [state?.readings]);

  if (onStart === null && state === null) return null;

  return (
    <div className="library-deep">
      <div className="library-deep-head">
        <button
          type="button"
          className="vibe-button"
          disabled={state?.running === true || onStart === null}
          onClick={() => onStart?.()}
          title="Decode each file a second time at its own rate and read where its spectrum stops. Slow, and the only way to see a transcode."
        >
          {state === null ? 'Deep check' : 'Check again'}
        </button>
        {state?.running === true ? (
          <span>
            Reading {state.done} of {state.total}
            {state.currentTitle === null ? '' : ` · ${state.currentTitle}`}
          </span>
        ) : (
          <span>
            {state === null
              ? 'Decodes every file again at full rate to find what the 16 kHz analysis cannot.'
              : `Read ${state.readings.length} files.`}
          </span>
        )}
      </div>

      {groups.size > 0 && (
        <ul className="library-issues">
          {VERDICT_ORDER.filter((verdict) => groups.has(verdict)).map((verdict) => {
            const found = groups.get(verdict) ?? [];
            const shown = found.slice(0, HEALTH_TRACKS_SHOWN);
            return (
              <li key={verdict}>
                <span className={`library-issue library-issue--${verdict}`}>
                  {VERDICT_TEXT[verdict].label}
                </span>
                <span className="library-issue-count">{found.length}</span>
                <p>{VERDICT_TEXT[verdict].detail}</p>
                <ol>
                  {shown.map((reading) => (
                    <li key={reading.trackId} title={reading.track.relPath}>
                      {displayName(reading.track)} · {describeCutoff(reading)}
                    </li>
                  ))}
                </ol>
                {found.length > shown.length && (
                  <p className="library-note">and {found.length - shown.length} more.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
  'dead-air': 'silence at the ends',
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

/**
 * The file, named the way the person would recognise it.
 *
 * Not called `name`: that is a global on `window`, and a local one of that name
 * shadowed by it type-checks against the DOM declaration and returns the page's
 * name instead of the track's.
 */
function displayName(track: Track): string {
  const title = track.meta.title ?? track.fileName.replace(/\.[^.]+$/, '');
  return track.meta.artist === null ? title : `${track.meta.artist} — ${title}`;
}

/**
 * The same, with what the file weighs per second.
 *
 * Not used in the deep-scan list, where the reading carries the bitrate already
 * and this would print it twice on one line.
 */
function label(track: Track): string {
  const kbps =
    track.durationSec !== null && track.durationSec > 0
      ? ` · ${Math.round((track.size * 8) / track.durationSec / 1000)}k`
      : '';
  return `${displayName(track)}${kbps}`;
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

/** Proposals listed before the rest are folded away. */
const NAMES_SHOWN = 10;

/**
 * The files that had no name, and what this library worked out to call them.
 *
 * The interesting half of this list is the half that came from the audio: a file
 * called `t3.mp3` matched to a tagged copy of the same recording, which nothing
 * about the two names, sizes or dates could have told you. The other half is read
 * off the folders, which is where the person who ripped it typed the artist once.
 *
 * Accepting writes into this library's index and never into the file. That is
 * stated here rather than left to be discovered, because a tagger that edits files
 * is a different and much more frightening program.
 */
function Names({
  names,
  namedCount,
  onAccept,
  onForget,
}: {
  names: readonly ProposedName[];
  namedCount: number;
  onAccept: () => void;
  onForget: () => void;
}): React.JSX.Element | null {
  const shown = names.slice(0, NAMES_SHOWN);
  const bySound = names.filter((proposal) => proposal.source === 'sound').length;

  if (names.length === 0 && namedCount === 0) return null;

  return (
    <section className="library-section library-section--wide library-section--names">
      <h3>names</h3>
      {names.length === 0 ? (
        <p className="library-note">
          Nothing left to name. {namedCount} {namedCount === 1 ? 'file carries' : 'files carry'} a
          name this library worked out.
        </p>
      ) : (
        <>
          <p className="library-note">
            {names.length} {names.length === 1 ? 'file has' : 'files have'} no name of their own.
            {bySound > 0 &&
              ` ${bySound} of them can be named from the audio: the same recording is here again, tagged.`}
          </p>
          <ul className="library-names">
            {shown.map((proposal) => (
              <li key={proposal.track.id}>
                <span className={`library-issue library-issue--${proposal.source}`}>
                  {proposal.source === 'sound' ? 'by sound' : 'by folder'}
                </span>
                <span className="library-names-was" title={proposal.track.relPath}>
                  {proposal.track.fileName}
                </span>
                <span className="library-names-to" aria-hidden="true">
                  →
                </span>
                <span className="library-names-now">{proposed(proposal)}</span>
                {proposal.from !== null && (
                  <span className="library-names-from">
                    from {displayName(proposal.from)} · {proposal.distance?.toFixed(3)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {names.length > shown.length && (
            <p className="library-note">and {names.length - shown.length} more.</p>
          )}
        </>
      )}
      <div className="library-want-actions">
        <button
          type="button"
          className="vibe-button"
          disabled={names.length === 0}
          onClick={onAccept}
          title="Store these names in this library’s index. The files on disk are not touched."
        >
          Accept {names.length > 0 ? `all ${names.length}` : 'all'}
        </button>
        <button
          type="button"
          className="vibe-button"
          disabled={namedCount === 0}
          onClick={onForget}
          title="Drop every name this library gave itself. The tags were never changed, so this is the whole of the undo."
        >
          Forget {namedCount > 0 ? namedCount : ''}
        </button>
      </div>
      <p className="library-legend">
        Written into this library’s index, never into the file. A rescan re-reads the real tags and
        leaves these alone.
      </p>
    </section>
  );
}

/** A proposal, as one line. */
function proposed(proposal: ProposedName): string {
  const artist = proposal.artist ?? proposal.track.meta.artist;
  const title = proposal.title ?? proposal.track.meta.title ?? '';
  return artist === null ? title : `${artist} — ${title}`;
}

/** Rows of a matched list shown before the rest are folded away. */
const WANT_ROWS_SHOWN = 15;

/**
 * Somebody else's list, against this shelf.
 *
 * The one file that crosses between a streaming service and a collection you own is
 * a few thousand lines of "Artist, Title", so this reads one and answers the
 * question it can answer: which of these are already here. Tags first, then the
 * names worked out above — which is how a file with no tags at all can still be
 * found by a list that names it.
 *
 * Nothing about the missing ones is guessed at. See `wantList.ts` for why a name
 * cannot be turned into a tempo or a key, and what is offered instead.
 */
function Wanted({
  report,
  onMatch,
}: {
  report: WantReport | null;
  onMatch: (text: string) => void;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const missing = report?.rows.filter((row) => row.track === null) ?? [];
  const owned = report?.rows.filter((row) => row.track !== null) ?? [];

  return (
    <section className="library-section library-section--wide library-section--want">
      <h3>want list</h3>
      <p className="library-note">
        Paste a list, or open one: an export from a streaming service (.csv), a playlist (.m3u), or
        one “Artist – Title” per line. It is read here and goes nowhere.
      </p>
      <textarea
        className="library-want-input"
        rows={3}
        value={text}
        placeholder={'Pixies – Debaser\nSlint – Breadcrumb Trail'}
        aria-label="Want list"
        onChange={(event) => setText(event.target.value)}
      />
      <div className="library-want-actions">
        <button
          type="button"
          className="vibe-button"
          disabled={text.trim() === ''}
          onClick={() => onMatch(text)}
        >
          Match
        </button>
        <label className="vibe-button library-want-open">
          Open a file…
          <input
            type="file"
            accept=".csv,.txt,.m3u,.m3u8,text/csv,text/plain,audio/x-mpegurl"
            aria-label="Open a want list"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared here so the same file can be opened twice in a row, which
              // an input keeps its value through and would otherwise ignore.
              event.target.value = '';
              if (file === undefined) return;
              void file.text().then(onMatch);
            }}
          />
        </label>
      </div>

      {report !== null && (
        <>
          <ul className="library-findings">
            {report.findings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {report.titleOnly > 0 && (
            <p className="library-legend">
              {report.titleOnly} of these lines name no artist. Those are matched on the title
              alone, and only when exactly one track answers to it.
            </p>
          )}
          <div className="library-want-lists">
            <WantColumn heading={`not here · ${missing.length}`} rows={missing} />
            <WantColumn heading={`on the shelf · ${owned.length}`} rows={owned} />
          </div>
        </>
      )}
    </section>
  );
}

function WantColumn({
  heading,
  rows,
}: {
  heading: string;
  rows: readonly WantRow[];
}): React.JSX.Element | null {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, WANT_ROWS_SHOWN);

  return (
    <div className="library-want-column">
      <h4>{heading}</h4>
      <ol>
        {shown.map((row, index) => (
          <li key={`${row.entry.line}-${index}`}>
            <span className="library-want-line">{row.entry.line}</span>
            {row.via !== null && row.via !== 'tags' && (
              <span
                className="library-issue library-issue--sound"
                title="Matched a name this library worked out from the audio, not from a tag"
              >
                {row.via === 'sound' ? 'by sound' : 'by folder'}
              </span>
            )}
            {row.artistNote !== null && <ArtistLine note={row.artistNote} />}
          </li>
        ))}
      </ol>
      {rows.length > shown.length && (
        <p className="library-note">and {rows.length - shown.length} more.</p>
      )}
    </div>
  );
}

/**
 * The only thing that can honestly be said about a record nobody here has heard:
 * what the copies of that artist already on the shelf are like.
 *
 * Phrased so that it cannot be misread as a measurement of the missing track. It
 * is a measurement of its neighbours.
 */
function ArtistLine({ note }: { note: ArtistNote }): React.JSX.Element {
  const tempo = note.medianBpm === null ? '' : `, around ${note.medianBpm} BPM`;
  const keys = note.keys.length === 0 ? '' : ` in ${note.keys.join(', ')}`;
  return (
    <span className="library-want-note">
      you have {note.owned} by {note.artist}
      {tempo}
      {keys}
      {note.island !== null &&
        ` — a corner of the wheel your other ${note.island.size === 1 ? 'track' : `${note.island.size} tracks`} there cannot be mixed out of`}
    </span>
  );
}

/** Tracks of the shared set listed before the rest are folded away. */
const COMMON_SHOWN = 12;

/**
 * Two collections, side by side, with nothing between them but a short code.
 *
 * The question people actually ask each other about music — what have we got in
 * common, and what have you got that I have never heard — is a question about two
 * libraries, and every service that could answer it would first have to be told
 * what both people own. The code carries two histograms and a count: no titles, no
 * artists, nothing that could be turned back into a list of records.
 *
 * What comes out is a resemblance, not an agreement: two collections can overlap
 * perfectly here and share not one track. So the last part is the only part that
 * can be played — the records *you* have that sit in the ground you share.
 */
function Compare({
  mine,
  comparison,
  common,
  onCopyCode,
  onCompare,
  onSaveCommon,
}: {
  /** Your own code, to send. */
  mine: string;
  comparison: ShapeComparison | null;
  common: readonly Track[];
  onCopyCode: () => void;
  onCompare: (code: string) => void;
  onSaveCommon: () => void;
}): React.JSX.Element {
  const [code, setCode] = useState('');
  const shown = common.slice(0, COMMON_SHOWN);

  return (
    <section className="library-section library-section--wide library-section--compare">
      <h3>compare</h3>
      <p className="library-note">
        Send somebody this code and they can see how your collections line up. It holds two
        histograms and a count — no titles, no artists, nothing that says what you own.
      </p>
      <div className="library-want-actions">
        <input className="library-code" readOnly value={mine} aria-label="Your shape code" />
        <button type="button" className="vibe-button" onClick={onCopyCode}>
          Copy
        </button>
      </div>
      <div className="library-want-actions">
        <input
          className="library-code"
          value={code}
          placeholder="paste theirs here"
          aria-label="Their shape code"
          onChange={(event) => setCode(event.target.value)}
        />
        <button
          type="button"
          className="vibe-button"
          disabled={code.trim() === ''}
          onClick={() => onCompare(code)}
        >
          Compare
        </button>
      </div>

      {comparison !== null && (
        <>
          <ul className="library-findings">
            {comparison.findings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="library-want-lists">
            <Overlap label="tempo" value={comparison.tempoOverlap} />
            <Overlap label="key" value={comparison.keyOverlap} />
          </div>

          {shown.length > 0 && (
            <div className="library-common">
              <h4>
                yours, from the ground you share · {common.length}
                <button type="button" className="vibe-button" onClick={onSaveCommon}>
                  Save .m3u
                </button>
              </h4>
              <ol>
                {shown.map((track) => (
                  <li key={track.id} title={track.relPath}>
                    {displayName(track)} · {Math.round(track.analysis?.bpm ?? 0)} ·{' '}
                    {track.analysis?.key.camelot ?? '--'}
                  </li>
                ))}
              </ol>
              {common.length > shown.length && (
                <p className="library-note">and {common.length - shown.length} more.</p>
              )}
            </div>
          )}
          {/* Said whatever the numbers were: the overlap is between two shapes,
              and two collections can look identical here and share no records. */}
          <p className="library-legend">
            A resemblance between two shapes, never a claim about what either of you owns.
          </p>
        </>
      )}
    </section>
  );
}

/** One overlap, as a bar and a number. */
function Overlap({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="library-overlap">
      <span className="library-overlap-label">{label}</span>
      <span className="library-overlap-bar">
        <span style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="library-overlap-value">{Math.round(value * 100)}%</span>
    </div>
  );
}

/** Names offered in the journey pickers at once. */
const CATALOGUE_SHOWN = 60;

/**
 * Getting from one record to another.
 *
 * The auto-DJ answers "what next", which is the question a radio asks. This is the
 * one a DJ asks: how do I get from here to there. Name the two ends and the route
 * between them is laid out, each step a move the planner would have been willing to
 * make anyway, with the reason for it printed beside it.
 *
 * Only a collection somebody has listened to can answer it. A service knows what
 * its catalogue is filed under; it does not know that these two records are four
 * moves apart, because nothing it stores is a distance.
 */
function Journey({
  catalogue,
  nowPlayingId,
  route,
  planning,
  onPlan,
  onPlay,
  onSave,
}: {
  catalogue: readonly CatalogueEntry[];
  nowPlayingId: string | null;
  route: readonly JourneyStep[] | null;
  planning: boolean;
  onPlan: (fromId: string, toId: string, steps: number) => void;
  onPlay: () => void;
  onSave: () => void;
}): React.JSX.Element | null {
  const playing = catalogue.find((entry) => entry.id === nowPlayingId) ?? null;
  const [fromText, setFromText] = useState(playing?.label ?? '');
  const [toText, setToText] = useState('');
  const [steps, setSteps] = useState(DEFAULT_JOURNEY_STEPS);
  const [problem, setProblem] = useState<string | null>(null);

  const byLabel = useMemo(() => {
    const map = new Map<string, CatalogueEntry>();
    for (const entry of catalogue) if (!map.has(entry.label)) map.set(entry.label, entry);
    return map;
  }, [catalogue]);

  if (catalogue.length < 4) return null;

  const resolve = (text: string): CatalogueEntry | null => {
    const wanted = text.trim();
    if (wanted === '') return null;
    const exact = byLabel.get(wanted);
    if (exact !== undefined) return exact;
    // One partial match is an answer; several is a question, and picking one of
    // them would send somebody somewhere they did not ask to go.
    const folded = wanted.toLowerCase();
    const matches = catalogue.filter((entry) => entry.label.toLowerCase().includes(folded));
    return matches.length === 1 ? (matches[0] ?? null) : null;
  };

  const plan = (): void => {
    const from = resolve(fromText);
    const to = resolve(toText);
    if (from === null || to === null) {
      setProblem('Type enough of a title to name one track, or pick one from the list.');
      return;
    }
    if (from.id === to.id) {
      setProblem('That is the same record at both ends.');
      return;
    }
    setProblem(null);
    onPlan(from.id, to.id, steps);
  };

  return (
    <section className="library-section library-section--wide library-section--journey">
      <h3>journey</h3>
      <p className="library-note">
        Name where you are and where you want to end up. The route between them is built from your
        own records, one defensible move at a time — nothing is sped up or slowed down.
      </p>

      <div className="library-journey-ends">
        <Picker
          label="from"
          value={fromText}
          onChange={setFromText}
          catalogue={catalogue}
          listId="journey-from"
        />
        <Picker
          label="to"
          value={toText}
          onChange={setToText}
          catalogue={catalogue}
          listId="journey-to"
        />
      </div>

      <div className="library-want-actions">
        <label htmlFor="journey-steps">steps</label>
        <select
          id="journey-steps"
          className="library-journey-steps"
          value={steps}
          onChange={(event) => setSteps(Number(event.target.value))}
        >
          {[2, 4, 6, 8, 12, 16].map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
        <button type="button" className="vibe-button" disabled={planning} onClick={plan}>
          {planning ? 'Planning…' : 'Plan'}
        </button>
        {route !== null && route.length > 0 && (
          <>
            <button type="button" className="vibe-button" onClick={onPlay}>
              Play it
            </button>
            <button type="button" className="vibe-button" onClick={onSave}>
              Save .m3u
            </button>
          </>
        )}
      </div>

      {problem !== null && <p className="library-legend library-legend--warn">{problem}</p>}

      {route !== null &&
        (route.length === 0 ? (
          <p className="library-note">
            No route between those two: there is not enough analysed music in between to make one
            without jumping. Fewer steps may find one.
          </p>
        ) : (
          <ol className="library-journey">
            {route.map((step, index) => (
              <li key={`${step.track.id}-${index}`}>
                <span className="library-journey-title" title={step.track.relPath}>
                  {displayName(step.track)}
                </span>
                <span className="library-journey-meta">
                  {Math.round(step.track.analysis?.bpm ?? 0)} · {step.track.analysis?.key.camelot}
                </span>
                {step.transition !== null && (
                  <span className="library-journey-move">{step.transition.summary}</span>
                )}
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}

/** One end of a journey: a box to type in, with the library behind it. */
function Picker({
  label,
  value,
  onChange,
  catalogue,
  listId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  catalogue: readonly CatalogueEntry[];
  listId: string;
}): React.JSX.Element {
  // Filtered as you type and capped: a datalist holding ten thousand options is
  // ten thousand DOM nodes, and nobody reads past the first few anyway.
  const options = useMemo(() => {
    const folded = value.trim().toLowerCase();
    const matches =
      folded === ''
        ? catalogue
        : catalogue.filter((entry) => entry.label.toLowerCase().includes(folded));
    return matches.slice(0, CATALOGUE_SHOWN);
  }, [catalogue, value]);

  return (
    <label className="library-journey-end">
      <span>{label}</span>
      <input
        className="library-code"
        list={listId}
        value={value}
        placeholder="type a title"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((entry) => (
          <option key={entry.id} value={entry.label} />
        ))}
      </datalist>
    </label>
  );
}

/** Joins listed before the rest are folded away. */
const SEGUES_SHOWN = 10;

/**
 * The tracks a record does not stop between.
 *
 * Shown because the player acts on it: these pairs are butted together rather than
 * cross-faded, whatever the fade is set to, and somebody who has chosen an eight
 * second fade deserves to know where it is not being applied and why.
 *
 * Every other player treats a file boundary as a track boundary. This one can tell
 * the difference because it listened to both ends.
 */
function Segues({ pairs }: { pairs: readonly SeguePair[] }): React.JSX.Element {
  const shown = pairs.slice(0, SEGUES_SHOWN);

  return (
    <section className="library-section library-section--wide library-section--segues">
      <h3>runs together</h3>
      {pairs.length === 0 ? (
        <p className="library-note">
          Nothing here runs into anything else: every track starts and ends on its own. Where two do
          run together, they are played butted up rather than faded.
        </p>
      ) : (
        <>
          <p className="library-note">
            {pairs.length} {pairs.length === 1 ? 'pair runs' : 'pairs run'} together — one ends at
            full level and the next starts there, and they are neighbours on a record. Played butted
            up rather than faded, whatever the fade is set to.
          </p>
          <ul className="library-segues">
            {shown.map((pair) => (
              <li key={`${pair.from.id}-${pair.to.id}`}>
                <span className="library-journey-title" title={pair.from.relPath}>
                  {displayName(pair.from)}
                </span>
                <span className="library-names-to" aria-hidden="true">
                  →
                </span>
                <span className="library-journey-title" title={pair.to.relPath}>
                  {displayName(pair.to)}
                </span>
              </li>
            ))}
          </ul>
          {pairs.length > shown.length && (
            <p className="library-note">and {pairs.length - shown.length} more.</p>
          )}
        </>
      )}
      {/* Said because it is the honest limit of the measurement, and because
          somebody will otherwise wonder why a pair they expected is missing. */}
      <p className="library-legend">
        Read off the two ends, not off the tags. A track that stops dead into one that starts on a
        beat looks the same from here as a true bleed — and wants the same treatment.
      </p>
    </section>
  );
}
