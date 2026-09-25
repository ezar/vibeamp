/**
 * Track fixtures for the tests that care about names rather than about audio.
 *
 * The descriptors here are filler. What these tests exercise is the identity half
 * of the record — tags, paths and the fingerprint — so everything else is set to
 * one plausible value and left alone.
 */

import { toCamelot } from '../camelot.js';
import { FINGERPRINT_FRAMES, FINGERPRINT_SEGMENTS, encodeFingerprint } from '../fingerprint.js';
import type { KeyScale, PitchClassName, Track, TrackAnalysis } from '../types.js';

export interface TrackSpec {
  id: string;
  relPath?: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  trackNo?: number | null;
  bpm?: number;
  root?: PitchClassName;
  scale?: KeyScale;
  durationSec?: number | null;
  /** Two tracks built from the same seed carry byte-identical fingerprints. */
  seed?: number | null;
  analysed?: boolean;
}

export function makeTrack(spec: TrackSpec): Track {
  const root = spec.root ?? 'C';
  const scale = spec.scale ?? 'major';
  const analysis: TrackAnalysis = {
    bpm: spec.bpm ?? 120,
    bpmConfidence: 0.9,
    key: { root, scale, strength: 0.8, margin: 0.3, camelot: toCamelot(root, scale) },
    loudnessDb: -10,
    energy: 0.5,
    brightness: 0.5,
    compression: 0.5,
    danceability: 0.5,
    provisional: false,
    inputs: { loudness: 0.2, brightness: 2000, compression: 5, danceability: 0.6 },
    fingerprint: spec.seed === undefined || spec.seed === null ? null : fingerprintFor(spec.seed),
    tailRatio: 0.05,
    headRatio: 0.05,
    clippedRatio: 0,
    sideRatio: 0.4,
    introBeatSec: 0,
    outroBeatSec: null,
    soundStartSec: 0,
    soundEndSec: 180,
    windows: [],
  };

  const relPath = spec.relPath ?? `${spec.id}.mp3`;
  return {
    id: spec.id,
    rootId: 'root',
    relPath,
    fileName: relPath.slice(relPath.lastIndexOf('/') + 1),
    size: 5_000_000,
    lastModified: 0,
    durationSec: spec.durationSec === undefined ? 200 : spec.durationSec,
    meta: {
      title: spec.title === undefined ? spec.id : spec.title,
      artist: spec.artist ?? null,
      albumArtist: null,
      album: spec.album ?? null,
      year: null,
      trackNo: spec.trackNo ?? null,
      genre: null,
      hasCoverArt: false,
    },
    analysis: (spec.analysed ?? true) ? analysis : null,
    analysisVersion: 3,
    analyzedAt: 1,
    status: (spec.analysed ?? true) ? 'done' : 'pending',
    attempts: 0,
  };
}

/**
 * A fingerprint that is reproducible from a number.
 *
 * Two tracks given the same seed hold the same recording as far as anything
 * downstream can tell; two given different seeds are unrelated music. Enough to
 * exercise the matching without decoding anything.
 */
export function fingerprintFor(seed: number): string {
  let state = (seed * 7919 + 104729) % 233280;
  const next = (): number => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  const frames: number[][] = [];
  for (let frame = 0; frame < FINGERPRINT_SEGMENTS * FINGERPRINT_FRAMES; frame += 1) {
    frames.push(Array.from({ length: 12 }, next));
  }
  const encoded = encodeFingerprint(frames);
  if (encoded === null) throw new Error('fixture fingerprint is the wrong shape');
  return encoded;
}
