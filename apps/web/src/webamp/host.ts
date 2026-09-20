/**
 * Creating the Webamp instance.
 *
 * Webamp is the shell: a faithful Winamp 2.9 with real `.wsz` skin support, window
 * docking, the hotkeys and the visualiser. vibeamp supplies the audio underneath it
 * and the library behind it, and does not reimplement any of that.
 *
 * Two extension points carry the integration:
 *
 * - `__customMediaClass` replaces Webamp's audio engine with {@link VibeampMedia},
 *   which is how the cross-fade and the headroom management get in.
 * - `filePickers` adds "Open folder…" to the shell's own menu, so choosing a library
 *   folder is where a Winamp user would look for it.
 *
 * Tracks are handed over as `BlobTrack`, never as URLs. A local file becomes a blob
 * and never leaves the device, and there is no CORS to satisfy.
 */

import Webamp from 'webamp';
import type { ButterchurnOptions, Options, Track as WebampTrack } from 'webamp';
import { VibeampMedia } from '../audio/VibeampMedia.js';
import { shellLayout } from './layout.js';
import { milkdropPresets } from './presets.js';
import type { SkinChoice } from '../skin/skins.js';
import type { Track as WebampTrackType } from 'webamp';

export interface HostOptions {
  /** Opens the folder picker and returns what it found, or `null` if cancelled. */
  openFolder: () => Promise<WebampTrack[] | null>;
  /** Called when the shell moves to another track, so the queue can top itself up. */
  onTrackChange?: (url: string | null) => void;
  /**
   * Called when something is dropped on the player.
   *
   * Dragging a folder in is what people try first, and it is the one entry point
   * the shell offers that does not need a menu. Returns true when it was handled,
   * so the shell's own drop behaviour can be skipped.
   */
  onDropFolder?: (event: React.DragEvent<HTMLDivElement>) => Promise<boolean>;
  /** Where to render. Webamp centres itself on this node. */
  container: HTMLElement;
  /** Skins the user has brought, listed in the shell's own skin menu. */
  skins?: readonly SkinChoice[];
  /** The skin to start in, or nothing for Webamp's built-in default. */
  initialSkin?: SkinChoice | undefined;
  /** Reads an `.m3u` the user picks into the playlist. */
  onLoadPlaylist?: () => Promise<WebampTrackType[] | null>;
  /** Writes the shell's playlist out as an `.m3u`. */
  onSavePlaylist?: (tracks: readonly WebampTrackType[]) => Promise<void>;
  /** Called when the user asks to add a URL, which this player has no use for. */
  onAddUrl?: () => void;
  /**
   * Called when the user picks a menu entry the shell has no handler hook for.
   *
   * @param what The entry's name, as the menu draws it.
   */
  onUnsupported?: (what: string) => void;
}

/**
 * The menu entries whose "Not supported in Webamp" alert is hard-coded.
 *
 * The other three have handler options and are answered properly above. These two
 * call `alert()` inline, so the only way to keep the wrong product's name off the
 * screen is to take the alert away for the length of the click. Keyed by the class
 * Webamp puts on the entry.
 */
const UNHOOKED_ENTRIES: ReadonlyArray<readonly [selector: string, name: string]> = [
  ['.remove-misc', 'Remove misc'],
  ['.file-info', 'File info'],
];

export interface WebampHost {
  webamp: Webamp;
  media: VibeampMedia;
  /** Open or close the MilkDrop window, the same as the shell's own menu entry. */
  toggleMilkdrop: () => void;
  dispose: () => void;
}

/** Whether this browser can run Webamp at all. */
export function isSupported(): boolean {
  return Webamp.browserIsSupported();
}

/** Build and render the shell. */
export async function createHost(options: HostOptions): Promise<WebampHost> {
  // Webamp constructs the media class itself, so the instance is captured on the way
  // past rather than passed in.
  let media: VibeampMedia | null = null;
  const capture = (instance: VibeampMedia): void => {
    media = instance;
  };

  class CapturedMedia extends VibeampMedia {
    constructor() {
      super();
      capture(this);
    }
  }

  const webampOptions: Options & {
    __customMediaClass?: typeof CapturedMedia;
    __butterchurnOptions?: ButterchurnOptions;
  } = {
    enableHotkeys: true,
    enableMediaSession: true,
    // Without a layout of its own, Webamp opens MilkDrop over the main window and
    // buries the transport under the visualiser.
    windowLayout: shellLayout(),
    // Webamp mounts itself at the end of <body> rather than inside the node it is
    // given, so the vibe window's place in the stack has to be settled explicitly.
    zIndex: 10,
    handleTrackDropEvent: (event) => {
      // Returning an empty list tells the shell we dealt with it. The scan fills the
      // playlist itself, through the same path as the menu entry.
      void options.onDropFolder?.(event);
      return [];
    },
    filePickers: [
      {
        contextMenuName: 'Open folder…',
        filePicker: async () => (await options.openFolder()) ?? [],
        // Nothing here goes near the network, which is what lets the shell offer it
        // while the app is offline.
        requiresNetwork: false,
      },
    ],
    ...(options.skins !== undefined && options.skins.length > 0
      ? { availableSkins: [...options.skins] }
      : {}),
    // Object URLs are same-origin, so the CORS warning on this option does not
    // apply: the skin never leaves the device it was loaded from.
    ...(options.initialSkin !== undefined ? { initialSkin: { url: options.initialSkin.url } } : {}),
    // Without these three, Webamp's fallback for a missing handler is a browser
    // alert reading "Not supported in Webamp", which names the wrong product at
    // somebody using this one.
    handleLoadListEvent: async () => (await options.onLoadPlaylist?.()) ?? null,
    handleSaveListEvent: async (tracks) => {
      await options.onSavePlaylist?.(tracks);
      return null;
    },
    handleAddUrlEvent: () => {
      // Returning null is what stops the alert. There is nothing to fetch: this
      // player reads the user's own files, and the interface says so instead.
      options.onAddUrl?.();
      return null;
    },
    /**
     * MilkDrop, loaded only when it is opened.
     *
     * Webamp also publishes a `webamp/butterchurn` entry point with the visualiser
     * built in, but that bundle is 2 MB against 920 KB for this one and the choice
     * is made at construction. Going through the import hook instead keeps the
     * visualiser out of the first load of a player that promises to start offline.
     */
    __butterchurnOptions: {
      // Unwrapped, because butterchurn predates modules: the import gives a
      // namespace whose `default` holds the library, and Webamp calls
      // `createVisualizer` on whatever this resolves to.
      importButterchurn: async () => {
        const module = await import('butterchurn');
        return module.default ?? module;
      },
      getPresets: () => milkdropPresets(),
      butterchurnOpen: false,
    },
    __customMediaClass: CapturedMedia,
  };

  const webamp = new Webamp(webampOptions as ConstructorParameters<typeof Webamp>[0]);
  const unsubscribe = webamp.onTrackDidChange((info) => {
    options.onTrackChange?.(info?.url ?? null);
  });

  // Runs before the click reaches the shell, which dispatches the alert from its own
  // handler on the same event. Nothing else in this app calls alert(), and the swap
  // is undone on the next task, so the window is one click wide.
  const swallowUnhookedAlert = (event: MouseEvent): void => {
    const name = entryClickedIn(event);
    if (name === null) return;

    const original = window.alert;
    window.alert = () => options.onUnsupported?.(name);
    setTimeout(() => {
      window.alert = original;
    }, 0);
  };
  document.addEventListener('click', swallowUnhookedAlert, { capture: true });

  await webamp.renderWhenReady(options.container);
  if (media === null) throw new Error('Webamp did not construct the media class');

  return {
    webamp,
    media,
    // `store` is part of Webamp's published surface and this action is a declared
    // member of its `Action` union, so this is the API rather than a way around it.
    // The shell owns the state: closing the window from its own title bar and then
    // pressing the button again does the right thing without anything to keep in
    // sync here.
    toggleMilkdrop: () => webamp.store.dispatch({ type: 'TOGGLE_WINDOW', windowId: 'milkdrop' }),
    dispose: () => {
      document.removeEventListener('click', swallowUnhookedAlert, { capture: true });
      unsubscribe();
      webamp.dispose();
    },
  };
}

/** Which unhooked menu entry a click landed on, or null for anything else. */
function entryClickedIn(event: MouseEvent): string | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;

  for (const [selector, name] of UNHOOKED_ENTRIES) {
    if (target.closest(selector) !== null) return name;
  }
  return null;
}
