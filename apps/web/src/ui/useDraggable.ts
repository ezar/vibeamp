/**
 * Dragging a window by its title bar.
 *
 * Webamp's own windows drag, and a panel beside them that does not feel stuck to the
 * page. Pointer events rather than mouse events, so it works with a trackpad, a
 * touchscreen and a pen without three code paths.
 */

import { useCallback, useRef, useState } from 'react';

export interface Position {
  x: number;
  y: number;
}

export interface Draggable {
  position: Position;
  /** Spread onto the element that starts the drag, usually the title bar. */
  handleProps: {
    onPointerDown: (event: React.PointerEvent) => void;
  };
}

export function useDraggable(initial: Position): Draggable {
  const [position, setPosition] = useState(initial);
  const origin = useRef<{ pointer: Position; start: Position } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Capture on the handle, so a fast drag that leaves the element keeps
      // delivering moves instead of stopping halfway across the screen.
      const handle = event.currentTarget as HTMLElement;
      handle.setPointerCapture(event.pointerId);
      origin.current = {
        pointer: { x: event.clientX, y: event.clientY },
        start: position,
      };

      const move = (moveEvent: PointerEvent): void => {
        const from = origin.current;
        if (from === null) return;
        setPosition({
          // Clamped to the viewport, so a window can never be dragged somewhere it
          // cannot be dragged back from.
          x: clamp(from.start.x + moveEvent.clientX - from.pointer.x, 0, window.innerWidth - 60),
          y: clamp(from.start.y + moveEvent.clientY - from.pointer.y, 0, window.innerHeight - 20),
        });
      };

      const up = (): void => {
        origin.current = null;
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    },
    [position],
  );

  return { position, handleProps: { onPointerDown } };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
