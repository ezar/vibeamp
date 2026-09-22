/**
 * The shape of a collection.
 *
 * Every music app can tell you what you played most. None of them can tell you
 * what you *own*, because none of them has listened to it — they have tags, and
 * tags carry no tempo and no key.
 *
 * This is the one thing a player that analyses its own library can say and a
 * streaming service cannot. It is descriptive and nothing more: it counts, it does
 * not recommend, and it never suggests that a collection should look some other
 * way than it does.
 *
 * Only analysed tracks are counted. A histogram that silently mixed measured
 * tempos with absent ones would put a peak wherever the analysis happened to have
 * got to.
 */

import { compatibleCodes, parseCamelot } from './camelot.js';
import type { Track } from './types.js';

/** Width of a tempo bucket, in BPM. */
export const TEMPO_BUCKET_BPM = 10;
/** Lowest tempo the histogram shows. Below this is not a pulse anyone dances to. */
export const TEMPO_MIN_BPM = 60;
/** Highest tempo the histogram shows. */
export const TEMPO_MAX_BPM = 200;

/**
 * Confidence below which a tempo is left out of the histogram.
 *
 * An estimator with no pulse to find returns a number anyway. Counting those
 * builds a peak out of the estimator's own preferences rather than the music's.
 */
const MIN_TEMPO_CONFIDENCE = 0.3;

/** The same, for key: below this the code is a guess and the wheel would lie. */
const MIN_KEY_STRENGTH = 0.5;

export interface TempoBucket {
  /** Inclusive lower edge, in BPM. */
  fromBpm: number;
  /** Exclusive upper edge, in BPM. */
  toBpm: number;
  count: number;
}

export interface KeySlice {
  /** Position on the wheel, 1..12. */
  number: number;
  /** `A` for minor, `B` for major. */
  letter: 'A' | 'B';
  camelot: string;
  count: number;
}

export interface DecadeCount {
  /** First year of the decade, e.g. 1990. */
  decade: number;
  count: number;
}

export interface TempoGap {
  /** Top of the last occupied bucket below the gap, in BPM. */
  fromBpm: number;
  /** Bottom of the first occupied bucket above it, in BPM. */
  toBpm: number;
}

export interface KeyIsland {
  /** The codes in it, in wheel order. */
  codes: string[];
  /** Tracks across those codes. */
  count: number;
}

/**
 * Where a collection cannot go.
 *
 * The charts say where the music is; this says where it is not, which is the half
 * that can be acted on. A hole in the tempo range is a set that has to jump across
 * it. A wheel that falls into more than one island is a collection that cannot be
 * mixed end to end at all, and the codes that would join them are a shopping list.
 */
export interface LibraryGaps {
  /** Empty stretches with music on both sides, widest first. */
  tempo: TempoGap[];
  /**
   * Groups of occupied keys that can reach each other by moves the wheel allows,
   * largest first. One island is a collection that mixes end to end.
   */
  islands: KeyIsland[];
  /**
   * Empty codes that would join two or more islands, most joined first.
   *
   * Empty when there is nothing to join, which is the healthy case and not a
   * finding.
   */
  bridges: string[];
}

export interface LibraryShape {
  /** Tracks with descriptors. Everything below is counted from these. */
  analysed: number;
  /** Tracks in the library, analysed or not. */
  total: number;
  /** Total playing time of the analysed tracks, in seconds. */
  playingTimeSec: number;
  /** One bucket per {@link TEMPO_BUCKET_BPM}, always the full range so the chart
   *  keeps its axis when a library only occupies part of it. */
  tempo: TempoBucket[];
  /** All 24 codes, in wheel order: 1A, 1B, 2A, 2B and round. */
  keys: KeySlice[];
  /** Decades that have at least one track, oldest first. Empty without year tags. */
  decades: DecadeCount[];
  /** A few sentences about what the counts show. At most four, possibly none. */
  findings: string[];
  /** Where the collection cannot go. See {@link LibraryGaps}. */
  gaps: LibraryGaps;
}

/**
 * Measure a library.
 *
 * @param tracks Every track, analysed or not. The unanalysed ones are counted in
 *   `total` and nowhere else.
 */
export function libraryShape(tracks: readonly Track[]): LibraryShape {
  const analysed = tracks.filter((track) => track.analysis !== null);

  const tempo = buildTempoBuckets();
  let tempoCounted = 0;
  for (const track of analysed) {
    const analysis = track.analysis;
    if (analysis === null) continue;
    if (analysis.bpm <= 0 || analysis.bpmConfidence < MIN_TEMPO_CONFIDENCE) continue;
    const bucket = bucketFor(tempo, analysis.bpm);
    if (bucket === null) continue;
    bucket.count += 1;
    tempoCounted += 1;
  }

  const keys = buildKeySlices();
  const byCode = new Map(keys.map((slice) => [slice.camelot, slice]));
  let keysCounted = 0;
  for (const track of analysed) {
    const analysis = track.analysis;
    if (analysis === null || analysis.key.strength < MIN_KEY_STRENGTH) continue;
    const slice = byCode.get(analysis.key.camelot);
    if (slice === undefined) continue;
    slice.count += 1;
    keysCounted += 1;
  }

  const decades = new Map<number, number>();
  for (const track of analysed) {
    const year = track.meta.year;
    if (year === null || year < 1900 || year > 2100) continue;
    const decade = Math.floor(year / 10) * 10;
    decades.set(decade, (decades.get(decade) ?? 0) + 1);
  }

  const playingTimeSec = analysed.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);

  return {
    analysed: analysed.length,
    total: tracks.length,
    playingTimeSec,
    tempo,
    keys,
    decades: [...decades.entries()]
      .map(([decade, count]) => ({ decade, count }))
      .sort((a, b) => a.decade - b.decade),
    findings: describe({ tempo, tempoCounted, keys, keysCounted, playingTimeSec }),
    gaps: { tempo: tempoGaps(tempo), ...keyIslands(keys) },
  };
}

/**
 * Smallest empty stretch worth naming, in buckets.
 *
 * Two, which is twenty BPM. One empty bucket between two full ones is the ordinary
 * lumpiness of any collection; twenty BPM with nothing in it is a stretch a set has
 * to jump across.
 */
const MIN_TEMPO_GAP_BUCKETS = 2;

/**
 * Empty stretches of tempo with music on both sides.
 *
 * Only between occupied buckets. The empty space below the slowest track and above
 * the fastest is not a gap in a collection, it is the shape of it.
 */
function tempoGaps(buckets: readonly TempoBucket[]): TempoGap[] {
  const occupied = buckets.map((bucket) => bucket.count > 0);
  const first = occupied.indexOf(true);
  const last = occupied.lastIndexOf(true);
  if (first === -1 || last <= first) return [];

  const gaps: TempoGap[] = [];
  let run = 0;
  for (let i = first; i <= last; i += 1) {
    if (!occupied[i]) {
      run += 1;
      continue;
    }
    if (run >= MIN_TEMPO_GAP_BUCKETS) {
      gaps.push({
        fromBpm: buckets[i - run - 1]?.toBpm ?? TEMPO_MIN_BPM,
        toBpm: buckets[i]?.fromBpm ?? TEMPO_MAX_BPM,
      });
    }
    run = 0;
  }

  return gaps.sort((a, b) => b.toBpm - b.fromBpm - (a.toBpm - a.fromBpm));
}

/**
 * The wheel as a graph, and what it breaks into.
 *
 * Two codes are joined when the wheel allows the move between them: a step round
 * the circle in the same mode, or across to the relative major or minor. The
 * occupied codes then fall into one or more connected groups, and a collection
 * with more than one cannot be mixed from any track to any other.
 *
 * A bridge is an empty code touching two or more of those groups. Buying one track
 * in it joins them, which is the rare case of a library report that names
 * something to do.
 */
function keyIslands(slices: readonly KeySlice[]): { islands: KeyIsland[]; bridges: string[] } {
  const counts = new Map(slices.map((slice) => [slice.camelot, slice.count]));
  const occupied = slices.filter((slice) => slice.count > 0).map((slice) => slice.camelot);
  if (occupied.length === 0) return { islands: [], bridges: [] };

  const inLibrary = new Set(occupied);
  const seen = new Set<string>();
  const islands: KeyIsland[] = [];
  /** Which island each code ended up in, for the bridge pass. */
  const islandOf = new Map<string, number>();

  for (const start of occupied) {
    if (seen.has(start)) continue;

    const codes: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const code = queue.pop()!;
      codes.push(code);
      islandOf.set(code, islands.length);
      for (const neighbour of compatibleCodes(code)) {
        if (!inLibrary.has(neighbour) || seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }

    islands.push({
      codes: codes.sort(byWheelOrder),
      count: codes.reduce((sum, code) => sum + (counts.get(code) ?? 0), 0),
    });
  }

  islands.sort((a, b) => b.count - a.count);
  // The sort moved the islands, so the indices recorded above no longer name them.
  const placed = new Map<string, number>();
  islands.forEach((island, index) => {
    for (const code of island.codes) placed.set(code, index);
  });

  const bridges =
    islands.length < 2
      ? []
      : slices
          .filter((slice) => slice.count === 0)
          .map((slice) => ({
            code: slice.camelot,
            joins: new Set(
              compatibleCodes(slice.camelot)
                .map((neighbour) => placed.get(neighbour))
                .filter((index): index is number => index !== undefined),
            ).size,
          }))
          .filter((candidate) => candidate.joins >= 2)
          .sort((a, b) => b.joins - a.joins)
          .map((candidate) => candidate.code);

  return { islands, bridges };
}

/** 1A, 1B, 2A, 2B and round, so a listed island reads as a walk of the wheel. */
function byWheelOrder(a: string, b: string): number {
  const first = parseCamelot(a);
  const second = parseCamelot(b);
  if (first === null || second === null) return a.localeCompare(b);
  if (first.number !== second.number) return first.number - second.number;
  return first.letter.localeCompare(second.letter);
}

/**
 * What the counts amount to, in sentences.
 *
 * Deliberately few and deliberately plain. Each one has to be something a person
 * could not have known without this, and has to be true of the numbers above it
 * rather than a flourish written around them — so each is stated only when its
 * own condition holds, and a library that says nothing interesting gets nothing.
 */
function describe(input: {
  tempo: readonly TempoBucket[];
  tempoCounted: number;
  keys: readonly KeySlice[];
  keysCounted: number;
  playingTimeSec: number;
}): string[] {
  const findings: string[] = [];
  const { tempo, tempoCounted, keys, keysCounted, playingTimeSec } = input;

  if (playingTimeSec > 0) {
    findings.push(`${formatDuration(playingTimeSec)} of music, measured rather than tagged.`);
  }

  // The narrowest run of buckets holding half the library. A single peak bucket
  // says less: tempo is continuous, and 124 and 126 BPM are the same room.
  if (tempoCounted > 0) {
    const band = densestRun(
      tempo.map((bucket) => bucket.count),
      tempoCounted / 2,
    );
    if (band !== null) {
      const from = tempo[band.from]?.fromBpm ?? TEMPO_MIN_BPM;
      const to = tempo[band.to]?.toBpm ?? TEMPO_MAX_BPM;
      const share = Math.round((band.count / tempoCounted) * 100);
      findings.push(`Half of it lives between ${from} and ${to} BPM — ${share}% inside that band.`);
    }
  }

  if (keysCounted > 0) {
    const used = keys.filter((slice) => slice.count > 0).length;
    const busiest = [...keys].sort((a, b) => b.count - a.count)[0];
    if (busiest !== undefined && busiest.count > 0) {
      const share = Math.round((busiest.count / keysCounted) * 100);
      findings.push(
        `${busiest.camelot} is the most common key, at ${share}%. ${used} of the wheel's 24 positions are occupied.`,
      );
    }

    // Two adjacent codes are a mix; a wheel with a hole in it is a collection
    // that will never make one across that hole.
    const empty = keys.filter((slice) => slice.count === 0).map((slice) => slice.camelot);
    if (empty.length > 0 && empty.length <= 6) {
      findings.push(`Nothing at all in ${empty.join(', ')}.`);
    }
  }

  return findings.slice(0, 4);
}

/**
 * The shortest run of buckets whose counts reach `target`.
 *
 * A sliding window: widen until the window holds enough, then narrow from the left
 * for as long as it still does. Linear, and it answers "where does this library
 * actually sit" rather than "which single bucket won".
 *
 * @returns Null when no run reaches the target, which means there was nothing to
 *   count.
 */
function densestRun(
  counts: readonly number[],
  target: number,
): { from: number; to: number; count: number } | null {
  let best: { from: number; to: number; count: number } | null = null;
  let sum = 0;
  let from = 0;

  for (let to = 0; to < counts.length; to += 1) {
    sum += counts[to] ?? 0;
    while (sum - (counts[from] ?? 0) >= target && from < to) {
      sum -= counts[from] ?? 0;
      from += 1;
    }
    if (sum >= target && (best === null || to - from < best.to - best.from)) {
      best = { from, to, count: sum };
    }
  }
  return best;
}

function buildTempoBuckets(): TempoBucket[] {
  const buckets: TempoBucket[] = [];
  for (let bpm = TEMPO_MIN_BPM; bpm < TEMPO_MAX_BPM; bpm += TEMPO_BUCKET_BPM) {
    buckets.push({ fromBpm: bpm, toBpm: bpm + TEMPO_BUCKET_BPM, count: 0 });
  }
  return buckets;
}

/** The bucket a tempo falls in, or null when it is off the ends of the chart. */
function bucketFor(buckets: TempoBucket[], bpm: number): TempoBucket | null {
  if (bpm < TEMPO_MIN_BPM || bpm >= TEMPO_MAX_BPM) return null;
  return buckets[Math.floor((bpm - TEMPO_MIN_BPM) / TEMPO_BUCKET_BPM)] ?? null;
}

/** All 24 codes in wheel order, so the chart has a fixed set of positions. */
function buildKeySlices(): KeySlice[] {
  const slices: KeySlice[] = [];
  for (let number = 1; number <= 12; number += 1) {
    for (const letter of ['A', 'B'] as const) {
      const camelot = `${number}${letter}`;
      // Parsed rather than trusted, so a change to the notation cannot leave this
      // counting codes that no track will ever carry.
      if (parseCamelot(camelot) === null) continue;
      slices.push({ number, letter, camelot, count: 0 });
    }
  }
  return slices;
}

/** Hours and minutes, or minutes alone below an hour. */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) {
    if (minutes === 0) return 'Under a minute';
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (minutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours}h ${minutes}m`;
}
