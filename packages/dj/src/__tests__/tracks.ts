/** Track builders for the DJ tests. */

import { toCamelot } from '@vibeamp/core';
import type { KeyScale, PitchClassName, Track, TrackAnalysis, VibeTarget } from '@vibeamp/core';
import { mulberry32 } from './random.js';

export interface TrackSpec {
  id: string;
  bpm?: number;
  root?: PitchClassName;
  scale?: KeyScale;
  energy?: number;
  brightness?: number;
  danceability?: number;
  artist?: string | null;
  album?: string | null;
  bpmConfidence?: number;
  keyStrength?: number;
  status?: Track['status'];
  analysed?: boolean;
}

export function makeTrack(spec: TrackSpec): Track {
  const root = spec.root ?? 'C';
  const scale = spec.scale ?? 'major';
  const analysis: TrackAnalysis = {
    bpm: spec.bpm ?? 120,
    bpmConfidence: spec.bpmConfidence ?? 0.9,
    key: {
      root,
      scale,
      strength: spec.keyStrength ?? 0.8,
      margin: 0.3,
      camelot: toCamelot(root, scale),
    },
    loudnessDb: -10,
    energy: spec.energy ?? 0.5,
    brightness: spec.brightness ?? 0.5,
    compression: 0.5,
    danceability: spec.danceability ?? 0.5,
    provisional: false,
    inputs: { loudness: 0.2, brightness: 2000, compression: 5, danceability: 0.6 },
    fingerprint: null,
    tailRatio: 0.05,
    clippedRatio: 0,
    sideRatio: 0.4,
    introBeatSec: 0,
    outroBeatSec: null,
    soundStartSec: 0,
    soundEndSec: 180,
    windows: [],
  };

  const analysed = spec.analysed ?? true;
  return {
    id: spec.id,
    rootId: 'root',
    relPath: `${spec.id}.mp3`,
    fileName: `${spec.id}.mp3`,
    size: 1000,
    lastModified: 0,
    durationSec: 200,
    meta: {
      title: spec.id,
      artist: spec.artist === undefined ? `artist-${spec.id}` : spec.artist,
      albumArtist: null,
      album: spec.album === undefined ? `album-${spec.id}` : spec.album,
      year: null,
      trackNo: null,
      genre: null,
      hasCoverArt: false,
    },
    analysis: analysed ? analysis : null,
    analysisVersion: 1,
    analyzedAt: analysed ? 1 : null,
    status: spec.status ?? (analysed ? 'done' : 'pending'),
    attempts: 0,
  };
}

/** A library spread over tempo, key and energy, deterministic for a given seed. */
export function makeLibrary(count: number, seed = 42): Track[] {
  const random = mulberry32(seed);
  const roots: PitchClassName[] = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
  return Array.from({ length: count }, (_, i) => {
    const root = roots[Math.floor(random() * roots.length)] ?? 'C';
    return makeTrack({
      id: `t${i}`,
      bpm: 70 + Math.round(random() * 100),
      root,
      scale: random() < 0.5 ? 'major' : 'minor',
      energy: random(),
      brightness: random(),
      danceability: random(),
      artist: `artist-${i % 40}`,
      album: `album-${i % 80}`,
    });
  });
}

export const NEUTRAL_TARGET: VibeTarget = {
  energy: 0.5,
  brightness: 0.5,
  danceability: 0.5,
  familiarity: 0.5,
  coherence: 0.5,
};

/** A context that penalises nothing, so a test can isolate one term at a time. */
export function emptyContext() {
  return {
    recentArtists: [] as string[],
    recentAlbums: [] as string[],
    playedRecently: () => false,
    playFrequency: () => 0.5,
  };
}
