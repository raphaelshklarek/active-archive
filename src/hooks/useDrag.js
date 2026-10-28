import { useEffect, useRef } from 'react';

// Tracks mousemove/mouseup on the document while a drag (e.g. a resize handle)
// is `active`. Handlers are read through a ref so they always see the latest
// state; capturing them when the drag starts would hand `onEnd` stale values.
export function useDrag(active, onMove, onEnd) {
  const handlers = useRef({});
  handlers.current = { onMove, onEnd };

  useEffect(() => {
    if (!active) return;
    const move = (e) => handlers.current.onMove(e);
    const end = (e) => handlers.current.onEnd(e);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', end);
    };
  }, [active]);
}
