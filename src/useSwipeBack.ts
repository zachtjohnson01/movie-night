import { useEffect, useRef } from 'react';

// Standalone iOS PWAs don't get the native edge-swipe-back gesture,
// so we synthesize it. The gesture only fires on touch/pen input,
// must start within EDGE_PX of the left screen edge, and must travel
// MIN_DELTA_X horizontally without too much vertical wander — that
// rules out vertical scrolls and accidental flicks.
const EDGE_PX = 24;
const MIN_DELTA_X = 60;
const MAX_VERTICAL_RATIO = 0.6;

export function useSwipeBack(onBack: (() => void) | null) {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let activeId: number | null = null;

    function down(e: PointerEvent) {
      if (!handlerRef.current) return;
      if (e.pointerType === 'mouse') return;
      if (e.clientX > EDGE_PX) return;
      tracking = true;
      activeId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
    }

    function up(e: PointerEvent) {
      if (!tracking || e.pointerId !== activeId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      tracking = false;
      activeId = null;
      if (
        dx > MIN_DELTA_X &&
        Math.abs(dy) < dx * MAX_VERTICAL_RATIO &&
        handlerRef.current
      ) {
        handlerRef.current();
      }
    }

    function cancel() {
      tracking = false;
      activeId = null;
    }

    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);
}
