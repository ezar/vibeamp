/**
 * Application state.
 *
 * Only what the interface has to re-render on. The library itself lives in
 * IndexedDB and the playlist lives in Webamp's own store; duplicating either here
 * would mean two sources of truth for the same thing.
 */

import { create } from 'zustand';
import type { EnergyShape, VibeTarget } from '@vibeamp/core';
import type { RunnerProgress } from '../analysis/runner.js';

/** Where the sliders sit before the user touches anything. */
export const DEFAULT_VIBE_TARGET: VibeTarget = {
  energy: 0.5,
  brightness: 0.5,
  danceability: 0.5,
  familiarity: 0.5,
  coherence: 0.6,
};

export interface AppState {
  /** Null until a folder has been connected. */
  rootName: string | null;
  scanning: boolean;
  scanProgress: { found: number; currentPath: string } | null;
  analysis: RunnerProgress | null;
  /** How many tracks have usable descriptors, which gates the auto-DJ. */
  analysedCount: number;
  autoDjEnabled: boolean;
  vibeTarget: VibeTarget;
  energyShape: EnergyShape;
  crossfadeSec: number;
  /** Shown when the browser has no File System Access API. */
  needsReselect: boolean;
  error: string | null;

  setRootName: (name: string | null) => void;
  setScanning: (scanning: boolean) => void;
  setScanProgress: (progress: { found: number; currentPath: string } | null) => void;
  setAnalysis: (progress: RunnerProgress | null) => void;
  setAnalysedCount: (count: number) => void;
  setAutoDj: (enabled: boolean) => void;
  setVibe: (patch: Partial<VibeTarget>) => void;
  setEnergyShape: (shape: EnergyShape) => void;
  setCrossfade: (seconds: number) => void;
  setNeedsReselect: (needed: boolean) => void;
  setError: (message: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  rootName: null,
  scanning: false,
  scanProgress: null,
  analysis: null,
  analysedCount: 0,
  autoDjEnabled: false,
  vibeTarget: DEFAULT_VIBE_TARGET,
  energyShape: 'arc',
  crossfadeSec: 4,
  needsReselect: false,
  error: null,

  setRootName: (rootName) => set({ rootName }),
  setScanning: (scanning) => set({ scanning }),
  setScanProgress: (scanProgress) => set({ scanProgress }),
  setAnalysis: (analysis) => set({ analysis }),
  setAnalysedCount: (analysedCount) => set({ analysedCount }),
  setAutoDj: (autoDjEnabled) => set({ autoDjEnabled }),
  setVibe: (patch) => set((state) => ({ vibeTarget: { ...state.vibeTarget, ...patch } })),
  setEnergyShape: (energyShape) => set({ energyShape }),
  setCrossfade: (crossfadeSec) => set({ crossfadeSec }),
  setNeedsReselect: (needsReselect) => set({ needsReselect }),
  setError: (error) => set({ error }),
}));
