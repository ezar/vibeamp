/**
 * vibeamp's audio engine, injected into Webamp in place of its own.
 *
 * Webamp accepts a media implementation through `__customMediaClass`, which is what
 * lets the shell stay the real thing while the audio underneath it is ours. In
 * exchange the class has to honour Webamp's contract exactly: the shell drives it
 * through `IMedia` and subscribes to six events, and anything missing shows up as a
 * frozen time display or a playlist that never advances.
 *
 * What this adds over Webamp's own media: two decks so a track can cross-fade into
 * the next, and headroom management so a row of boosted bands cannot clip.
 *
 * The graph:
 *
 * ```
 * deck A <audio> -> source -> deck gain -\
 *                                         >- headroom -> preamp -> EQ x10
 * deck B <audio> -> source -> deck gain -/                            |
 *                                                                     v
 *   destination <- master gain <- analyser <- balance (split/merge) <--+
 * ```
 */

import { Emitter } from './emitter.js';
import { alignIncoming } from '@vibeamp/dj';
import type { TrackGrid } from '@vibeamp/dj';
import { EQ_BANDS, buildEqualiser, dbToGain, rampTo, sliderToDb } from './eq.js';

/** Default cross-fade length, in seconds. */
export const DEFAULT_CROSSFADE_SEC = 4;
/** Longest cross-fade the UI offers, in seconds. */
export const MAX_CROSSFADE_SEC = 12;
/**
 * The beat grids at each end of whatever is at a URL.
 *
 * Supplied by whoever owns the URLs, because this class deliberately knows nothing
 * about tracks — and a fade cannot wait for a database read, since it is happening
 * now.
 */
export type GridLookup = (
  url: string | null,
) => { intro: TrackGrid | null; outro: TrackGrid | null } | null;

/** FFT size for the visualiser. Webamp's own spectrum analyser expects this. */
const FFT_SIZE = 2048;
/** Smoothing of the visualiser, 0..1. Higher is calmer. */
const VISUALISER_SMOOTHING = 0.8;

/** One playback deck: an element, its source node and its cross-fade gain. */
interface Deck {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  /** The URL currently loaded. Owned by the caller, never revoked here. */
  url: string | null;
}

export class VibeampMedia {
  private readonly emitter = new Emitter();
  private readonly context: AudioContext;
  private readonly decks: [Deck, Deck];
  private readonly headroom: GainNode;
  private readonly preamp: GainNode;
  private readonly filters: BiquadFilterNode[];
  private readonly balanceLeft: GainNode;
  private readonly balanceRight: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly master: GainNode;

  private activeDeck = 0;
  private eqEnabled = true;
  /** Band slider values as Webamp sends them, 0..100 with 50 as flat. */
  private readonly bandValues = new Map<number, number>();
  private preampValue = 50;
  private crossfadeSec = DEFAULT_CROSSFADE_SEC;
  private beatAlign = false;
  private grids: GridLookup = () => null;

  constructor(context: AudioContext = new AudioContext()) {
    this.context = context;

    this.master = context.createGain();
    this.master.connect(context.destination);

    this.analyser = context.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = VISUALISER_SMOOTHING;
    this.analyser.connect(this.master);

    // Balance the way Winamp did it: attenuate one side, leave the other alone.
    // A StereoPannerNode would be less code but it pans with equal power, which
    // changes the sound of a centred signal.
    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);
    this.balanceLeft = context.createGain();
    this.balanceRight = context.createGain();
    splitter.connect(this.balanceLeft, 0);
    splitter.connect(this.balanceRight, 1);
    this.balanceLeft.connect(merger, 0, 0);
    this.balanceRight.connect(merger, 0, 1);
    merger.connect(this.analyser);

    this.filters = buildEqualiser(context);
    const firstFilter = this.filters[0];
    const lastFilter = this.filters[this.filters.length - 1];
    if (firstFilter === undefined || lastFilter === undefined) {
      throw new Error('the equaliser must have at least one band');
    }
    lastFilter.connect(splitter);

    this.preamp = context.createGain();
    this.preamp.connect(firstFilter);
    this.headroom = context.createGain();
    this.headroom.connect(this.preamp);

    this.decks = [this.createDeck(), this.createDeck()];
    for (const band of EQ_BANDS) this.bandValues.set(band, 50);
  }

  // ---- Webamp's IMedia ----

  on(event: string, callback: (...args: unknown[]) => void): () => void {
    return this.emitter.on(event, callback);
  }

  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  /** @param volume 0..100. */
  setVolume(volume: number): void {
    rampTo(this.master.gain, Math.max(0, Math.min(100, volume)) / 100, this.context);
  }

  /** @param balance -100 (hard left) to 100 (hard right). */
  setBalance(balance: number): void {
    const clamped = Math.max(-100, Math.min(100, balance)) / 100;
    rampTo(this.balanceLeft.gain, clamped > 0 ? 1 - clamped : 1, this.context);
    rampTo(this.balanceRight.gain, clamped < 0 ? 1 + clamped : 1, this.context);
  }

  /** @param value 0..100, 50 meaning no change. */
  setPreamp(value: number): void {
    this.preampValue = value;
    this.applyGains();
  }

  setEqBand(band: number, value: number): void {
    this.bandValues.set(band, value);
    this.applyGains();
  }

  enableEq(): void {
    this.eqEnabled = true;
    this.applyGains();
  }

  disableEq(): void {
    this.eqEnabled = false;
    this.applyGains();
  }

  duration(): number {
    const duration = this.current.element.duration;
    return Number.isFinite(duration) ? duration : 0;
  }

  timeElapsed(): number {
    return this.current.element.currentTime;
  }

  async play(): Promise<void> {
    // A context created before the first gesture starts suspended, and every
    // subsequent play() is silent until it is resumed.
    if (this.context.state === 'suspended') await this.context.resume();
    await this.current.element.play();
  }

  pause(): void {
    this.current.element.pause();
  }

  stop(): void {
    for (const deck of this.decks) {
      deck.element.pause();
      deck.element.currentTime = 0;
    }
  }

  /** @param percent 0..100. */
  seekToPercentComplete(percent: number): void {
    const duration = this.duration();
    if (duration === 0) return;
    this.current.element.currentTime = (Math.max(0, Math.min(100, percent)) / 100) * duration;
  }

  /**
   * Load a track and, if asked, start it.
   *
   * When something is already playing and a cross-fade is configured, the new track
   * goes onto the idle deck and the two are ramped past each other. Otherwise it
   * replaces what is on the active deck.
   *
   * Ordinary advance reaches here with audio still playing because
   * {@link CrossfadeScheduler} moves the shell on a cross-fade *before* the end.
   * Left to itself the shell asks for the next track after `ended`, and an ended
   * element reports itself paused — so there would be nothing to fade out of, and
   * only a manual skip would ever fade.
   */
  async loadFromUrl(url: string, autoPlay: boolean): Promise<void> {
    const playing = !this.current.element.paused && this.current.element.currentTime > 0;
    const shouldCrossfade = playing && autoPlay && this.crossfadeSec > 0;

    const target = shouldCrossfade ? this.decks[this.activeDeck === 0 ? 1 : 0] : this.current;
    this.loadInto(target, url);

    if (shouldCrossfade) {
      const outgoing = this.current;
      this.activeDeck = this.activeDeck === 0 ? 1 : 0;
      await this.play();
      this.crossfade(outgoing, target);
      return;
    }

    if (autoPlay) await this.play();
  }

  dispose(): void {
    for (const deck of this.decks) {
      deck.element.pause();
      deck.element.removeAttribute('src');
    }
    this.emitter.dispose();
    void this.context.close();
  }

  // ---- vibeamp's own surface ----

  /**
   * The URL on the active deck, or `null` before anything has loaded.
   *
   * The cross-fade scheduler needs it to tell one track from the next: it has to
   * arm itself once per track, and the only thing that changes between them here
   * is what is loaded.
   */
  currentUrl(): string | null {
    return this.current.url;
  }

  /** @param seconds 0 to {@link MAX_CROSSFADE_SEC}. 0 plays tracks back to back. */
  setCrossfadeSeconds(seconds: number): void {
    this.crossfadeSec = Math.max(0, Math.min(MAX_CROSSFADE_SEC, seconds));
  }

  getCrossfadeSeconds(): number {
    return this.crossfadeSec;
  }

  /** Bring the next track in on a beat of the one going out. See `align.ts`. */
  setBeatAlign(enabled: boolean): void {
    this.beatAlign = enabled;
  }

  /** Where to find the beat grids for a URL. */
  setGridLookup(lookup: GridLookup): void {
    this.grids = lookup;
  }

  // ---- internals ----

  private get current(): Deck {
    return this.decks[this.activeDeck] as Deck;
  }

  private createDeck(): Deck {
    const element = new Audio();
    element.preload = 'auto';
    // Needed for an object URL from a local file to reach the graph at all.
    element.crossOrigin = 'anonymous';

    const gain = this.context.createGain();
    gain.connect(this.headroom);
    const source = this.context.createMediaElementSource(element);
    source.connect(gain);

    const deck: Deck = { element, source, gain, url: null };
    this.wireEvents(deck);
    return deck;
  }

  /**
   * Relay one deck's element events as the six Webamp listens for.
   *
   * Only the active deck may speak. Without that guard the outgoing deck's `ended`
   * during a cross-fade advances the playlist a second time, and the queue eats a
   * track on every transition.
   */
  private wireEvents(deck: Deck): void {
    const fromActive = (): boolean => this.current === deck;

    deck.element.addEventListener('timeupdate', () => {
      if (fromActive()) this.emitter.emit('timeupdate');
    });
    deck.element.addEventListener('ended', () => {
      if (fromActive()) this.emitter.emit('ended');
    });
    deck.element.addEventListener('playing', () => {
      if (fromActive()) this.emitter.emit('playing');
    });
    deck.element.addEventListener('waiting', () => {
      if (fromActive()) this.emitter.emit('waiting');
    });
    deck.element.addEventListener('canplay', () => {
      if (fromActive()) this.emitter.emit('stopWaiting');
    });
    deck.element.addEventListener('loadedmetadata', () => {
      if (fromActive()) this.emitter.emit('fileLoaded');
    });
    deck.element.addEventListener('error', () => {
      if (fromActive()) this.emitter.emit('stopWaiting');
    });
  }

  /**
   * Point a deck at a URL.
   *
   * The URL is not revoked here even when it is an object URL. Whoever created it
   * owns it, and in vibeamp that is the playlist bridge, which still needs it to
   * identify the track. Revoking another owner's URL makes a track fail to load the
   * second time it is played.
   */
  private loadInto(deck: Deck, url: string): void {
    deck.url = url;
    deck.element.src = url;
    deck.gain.gain.value = 1;
  }

  /** Ramp `outgoing` down and `incoming` up over the cross-fade length. */
  private crossfade(outgoing: Deck, incoming: Deck): void {
    this.alignToBeat(outgoing, incoming);

    const now = this.context.currentTime;
    const end = now + this.crossfadeSec;

    outgoing.gain.gain.cancelScheduledValues(now);
    outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, now);
    outgoing.gain.gain.linearRampToValueAtTime(0, end);

    incoming.gain.gain.cancelScheduledValues(now);
    incoming.gain.gain.setValueAtTime(0, now);
    incoming.gain.gain.linearRampToValueAtTime(1, end);

    // Freeing the element rather than leaving it paused at full volume, so the next
    // cross-fade onto this deck starts from silence.
    window.setTimeout(
      () => {
        if (this.current !== outgoing) outgoing.element.pause();
      },
      this.crossfadeSec * 1000 + 100,
    );
  }

  /**
   * Start the incoming track from the point that puts its next beat on the
   * outgoing track's next beat.
   *
   * Done here, at the top of the fade, for one reason: the incoming deck is at
   * zero gain for the next few seconds, so seeking it is completely inaudible. A
   * second later the same seek would be a click.
   *
   * At most one beat of the opening is skipped, and only ever forward — there is
   * nothing before the start of a file, and the grid repeats anyway, so a beat
   * later is the same beat.
   */
  private alignToBeat(outgoing: Deck, incoming: Deck): void {
    if (!this.beatAlign) return;

    const at = alignedStart({
      outgoing: this.grids(outgoing.url)?.outro ?? null,
      outgoingAtSec: outgoing.element.currentTime,
      incoming: this.grids(incoming.url)?.intro ?? null,
      incomingAtSec: incoming.element.currentTime,
      incomingDurationSec: incoming.element.duration,
    });
    if (at === null) return;
    incoming.element.currentTime = at;
  }

  /**
   * Push the preamp and band gains into the graph.
   *
   * The headroom gain is the part Webamp's own media does not do: ten bands boosted
   * by 12 dB is a lot of gain, and without backing it out the output clips before
   * the master fader can do anything about it. Only boosts are counted, because
   * cuts cannot clip.
   */
  private applyGains(): void {
    let boostDb = 0;
    for (const band of EQ_BANDS) {
      const db = this.eqEnabled ? sliderToDb(this.bandValues.get(band) ?? 50) : 0;
      const filter = this.filters[EQ_BANDS.indexOf(band)];
      if (filter !== undefined) rampTo(filter.gain, db, this.context);
      if (db > 0) boostDb = Math.max(boostDb, db);
    }

    rampTo(this.preamp.gain, dbToGain(sliderToDb(this.preampValue)), this.context);
    rampTo(this.headroom.gain, dbToGain(-boostDb), this.context);
  }
}

/**
 * Where the incoming deck should be put so its next beat meets the outgoing one's.
 *
 * Separated from the deck it is applied to so that it can be tested without a
 * browser: the arithmetic lives in `align.ts`, and what is left here is the three
 * ways it can come to nothing.
 *
 * @returns The playhead position to seek to, or null when there is nothing to do —
 *   either track without a grid, a skip of zero, or a skip that would run off the
 *   end of a track shorter than one beat's remainder, which would restart it rather
 *   than nudge it.
 */
export function alignedStart(input: {
  outgoing: TrackGrid | null;
  outgoingAtSec: number;
  incoming: TrackGrid | null;
  incomingAtSec: number;
  incomingDurationSec: number;
}): number | null {
  const alignment = alignIncoming(
    input.outgoing,
    input.outgoingAtSec,
    input.incoming,
    input.incomingAtSec,
  );
  if (alignment === null || alignment.skipSec <= 0) return null;

  const at = input.incomingAtSec + alignment.skipSec;
  const duration = input.incomingDurationSec;
  if (Number.isFinite(duration) && at >= duration) return null;
  return at;
}
