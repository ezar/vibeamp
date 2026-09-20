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
import type { Options, Track as WebampTrack } from 'webamp';
import { VibeampMedia } from '../audio/VibeampMedia.js';

export interface HostOptions {
  /** Opens the folder picker and returns what it found, or `null` if cancelled. */
  openFolder: () => Promise<WebampTrack[] | null>;
  /** Called when the shell moves to another track, so the queue can top itself up. */
  onTrackChange?: (url: string | null) => void;
  /** Where to render. Webamp centres itself on this node. */
  container: HTMLElement;
}

export interface WebampHost {
  webamp: Webamp;
  media: VibeampMedia;
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

  const webampOptions: Options & { __customMediaClass?: typeof CapturedMedia } = {
    enableHotkeys: true,
    enableMediaSession: true,
    // Webamp mounts itself at the end of <body> rather than inside the node it is
    // given, so the vibe window's place in the stack has to be settled explicitly.
    zIndex: 10,
    filePickers: [
      {
        contextMenuName: 'Open folder…',
        filePicker: async () => (await options.openFolder()) ?? [],
        // Nothing here goes near the network, which is what lets the shell offer it
        // while the app is offline.
        requiresNetwork: false,
      },
    ],
    __customMediaClass: CapturedMedia,
  };

  const webamp = new Webamp(webampOptions as ConstructorParameters<typeof Webamp>[0]);
  const unsubscribe = webamp.onTrackDidChange((info) => {
    options.onTrackChange?.(info?.url ?? null);
  });

  await webamp.renderWhenReady(options.container);
  if (media === null) throw new Error('Webamp did not construct the media class');

  return {
    webamp,
    media,
    dispose: () => {
      unsubscribe();
      webamp.dispose();
    },
  };
}
