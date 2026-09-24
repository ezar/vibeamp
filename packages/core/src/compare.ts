/**
 * Two collections, side by side.
 *
 * What people actually want from a music service and never get: not "listeners
 * also liked", but *what do you and I have in common, and what have you got that I
 * have never heard of*. It is a question about two libraries, and the obvious way
 * to answer it is for both of them to be on somebody's server.
 *
 * They are not. A shape code (see `shapeCode.ts`) carries two histograms and a
 * count — no titles, no artists, nothing that could be turned back into a list of
 * what anybody owns — and the comparison runs on the machine that already holds
 * the records.
 *
 * The honest limits are worth stating, because this is a comparison of shapes and
 * not of records. Two collections can overlap perfectly here and share not one
 * track: both being full of 128 BPM music in 8A is a resemblance, not an
 * agreement. So the report never says "you both own"; it says where you both live,
 * which is what a histogram can support — and then it does the one thing that
 * turns that into something to play, which is to pick the records *you* have that
 * sit in the part of the map you share.
 */

import { TEMPO_BUCKET_BPM, TEMPO_MIN_BPM } from './shape.js';
import { ownShape } from './shapeCode.js';
import type { LibraryShape } from './shape.js';
import type { SharedShape } from './shapeCode.js';
import type { Track } from './types.js';

/**
 * Share of a distribution below which a position is not somewhere a library lives.
 *
 * Two percent. A twenty-fourth of the wheel is four percent, so this is "about
 * half of an even spread": low enough that a real corner of a collection counts,
 * high enough that one track in a library of a thousand does not.
 */
const PRESENT = 0.02;

/** Share below which a position counts as empty for the other side's sake. */
const ABSENT = 0.005;

/** A stretch of tempo, and how much of a library lives in it. */
export interface TempoBand {
  fromBpm: number;
  toBpm: number;
  /** Share of that library between those tempos, 0..1. */
  share: number;
}

export interface ShapeComparison {
  /** Tracks the other library measured, as its code reported. */
  theirAnalysed: number;
  /** How much of the two tempo curves is the same curve, 0..1. */
  tempoOverlap: number;
  /** The same for the wheel. */
  keyOverlap: number;
  /** Where they live and you do not, widest share first. */
  theirsAlone: { tempo: TempoBand[]; keys: string[] };
  /** And the other way round. */
  yoursAlone: { tempo: TempoBand[]; keys: string[] };
  /** Where you both live: the ground a set could be built on. */
  common: { tempo: TempoBand[]; keys: string[] };
  /** A few sentences, each true of the numbers above it. */
  findings: string[];
}

/**
 * Compare your library against a shape somebody sent you.
 *
 * @param mine Your own shape, as the X-ray measured it.
 * @param theirs What their code decoded to.
 */
export function compareShapes(mine: LibraryShape, theirs: SharedShape): ShapeComparison {
  const ours = ownShape(mine);
  const codes = mine.keys.map((slice) => slice.camelot);

  const tempoOverlap = intersection(ours.tempo, theirs.tempo);
  const keyOverlap = intersection(ours.keys, theirs.keys);

  const theirsAlone = {
    tempo: bands(
      theirs.tempo,
      (index) => (theirs.tempo[index] ?? 0) >= PRESENT && (ours.tempo[index] ?? 0) < ABSENT,
    ),
    keys: codes.filter(
      (_, index) => (theirs.keys[index] ?? 0) >= PRESENT && (ours.keys[index] ?? 0) < ABSENT,
    ),
  };
  const yoursAlone = {
    tempo: bands(
      ours.tempo,
      (index) => (ours.tempo[index] ?? 0) >= PRESENT && (theirs.tempo[index] ?? 0) < ABSENT,
    ),
    keys: codes.filter(
      (_, index) => (ours.keys[index] ?? 0) >= PRESENT && (theirs.keys[index] ?? 0) < ABSENT,
    ),
  };
  const common = {
    tempo: bands(
      ours.tempo.map((share, index) => Math.min(share, theirs.tempo[index] ?? 0)),
      (index) => (ours.tempo[index] ?? 0) >= PRESENT && (theirs.tempo[index] ?? 0) >= PRESENT,
    ),
    keys: codes.filter(
      (_, index) => (ours.keys[index] ?? 0) >= PRESENT && (theirs.keys[index] ?? 0) >= PRESENT,
    ),
  };

  return {
    theirAnalysed: theirs.analysed,
    tempoOverlap,
    keyOverlap,
    theirsAlone,
    yoursAlone,
    common,
    findings: describe({ mine, theirs, tempoOverlap, keyOverlap, theirsAlone, common }),
  };
}

/**
 * The records of yours that sit where you both live.
 *
 * The one thing a comparison of histograms can turn into something to play. Every
 * track here is yours and has been heard by this machine; nothing about it is a
 * claim about their collection beyond the region the two codes agree on.
 *
 * @param limit How many to return at most.
 * @returns Tracks in tempo order, which is a listenable one, or empty when the two
 *   collections share no ground — which is an answer and not a failure.
 */
export function commonGround(
  tracks: readonly Track[],
  comparison: ShapeComparison,
  limit = 20,
): Track[] {
  const { tempo, keys } = comparison.common;
  if (tempo.length === 0 && keys.length === 0) return [];
  const codes = new Set(keys);

  const inBoth = tracks.filter((track) => {
    const analysis = track.analysis;
    if (analysis === null) return false;
    const onTempo = tempo.some((band) => analysis.bpm >= band.fromBpm && analysis.bpm < band.toBpm);
    // Both, where there is both to have: a track that matches on tempo alone is in
    // the right room at the wrong pitch, and this list is short enough to be picky.
    if (tempo.length > 0 && keys.length > 0) return onTempo && codes.has(analysis.key.camelot);
    return tempo.length > 0 ? onTempo : codes.has(analysis.key.camelot);
  });

  // Ranked before it is cut: the busiest shared band first, so a library with
  // three hundred candidates offers the middle of the common ground rather than
  // whichever twenty tracks the table happened to return first. Then sorted by
  // tempo, because that is the order somebody would play them in.
  const weight = (track: Track): number => {
    const bpm = track.analysis?.bpm ?? 0;
    return tempo.find((band) => bpm >= band.fromBpm && bpm < band.toBpm)?.share ?? 0;
  };

  return [...inBoth]
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, limit)
    .sort((a, b) => (a.analysis?.bpm ?? 0) - (b.analysis?.bpm ?? 0));
}

/** Histogram intersection: the share of one distribution that sits under the other. */
function intersection(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    total += Math.min(a[i] ?? 0, b[i] ?? 0);
  }
  return total;
}

/**
 * Runs of adjacent buckets that pass a test, as tempo ranges.
 *
 * Adjacent buckets are joined because tempo is continuous: "124 to 134" and "134 to
 * 144" are one stretch of music, and reporting them as two is reporting the width
 * of the bucket rather than the shape of the library.
 */
function bands(shares: readonly number[], keep: (index: number) => boolean): TempoBand[] {
  const out: TempoBand[] = [];
  let from: number | null = null;
  let share = 0;

  const close = (to: number): void => {
    if (from === null) return;
    out.push({
      fromBpm: TEMPO_MIN_BPM + from * TEMPO_BUCKET_BPM,
      toBpm: TEMPO_MIN_BPM + to * TEMPO_BUCKET_BPM,
      share,
    });
    from = null;
    share = 0;
  };

  for (let i = 0; i < shares.length; i += 1) {
    if (keep(i)) {
      if (from === null) from = i;
      share += shares[i] ?? 0;
      continue;
    }
    close(i);
  }
  close(shares.length);

  return out.sort((a, b) => b.share - a.share);
}

/**
 * What the two shapes amount to, in sentences.
 *
 * Each one is about distributions, never about records: "they live at 90 BPM and
 * you do not" is supported by two histograms, and "they have records you would
 * like" is not supported by anything here.
 */
function describe(input: {
  mine: LibraryShape;
  theirs: SharedShape;
  tempoOverlap: number;
  keyOverlap: number;
  theirsAlone: { tempo: TempoBand[]; keys: string[] };
  common: { tempo: TempoBand[]; keys: string[] };
}): string[] {
  const { mine, theirs, tempoOverlap, keyOverlap, theirsAlone, common } = input;
  const findings: string[] = [];

  findings.push(
    `Their ${theirs.analysed} against your ${mine.analysed}: ${percent(tempoOverlap)} of the tempo curve is shared, and ${percent(keyOverlap)} of the wheel.`,
  );

  const band = common.tempo[0];
  if (band !== undefined) {
    const where =
      common.keys.length === 0 || common.keys.length > 4 ? '' : `, in ${common.keys.join(', ')}`;
    findings.push(`You are both at home between ${band.fromBpm} and ${band.toBpm} BPM${where}.`);
  } else {
    findings.push('There is no tempo you are both at home in.');
  }

  const theirBand = theirsAlone.tempo[0];
  if (theirBand !== undefined && theirBand.share >= 0.08) {
    findings.push(
      `${percent(theirBand.share)} of theirs is between ${theirBand.fromBpm} and ${theirBand.toBpm} BPM, where you have next to nothing.`,
    );
  }

  if (theirsAlone.keys.length > 0 && theirsAlone.keys.length <= 6) {
    findings.push(`They keep music in ${theirsAlone.keys.join(', ')} and you do not.`);
  }

  return findings.slice(0, 4);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
