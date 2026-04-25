import { useEffect, useRef } from 'react';

// Standalone iOS PWAs don't get the native edge-swipe-back gesture,
// and Safari's native edge-swipe will hijack ours unless we actively
// claim it on touchstart. iOS commits to its own gesture early —
// touchmove preventDefault arrives too late once Safari has decided.
// So we preventDefault on touchstart with passive: false, but skip
// the block when the touch landed on the in-header Back button so
// its tap still fires.
const EDGE_PX = 24;
const MIN_DELTA_X = 60;
const MAX_VERTICAL_RATIO = 0.6;
const CLAIM_DX = 8;

export function useSwipeBack(onBack: (() => void) | null) {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onStart(e: TouchEvent) {
      if (!handlerRef.current) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_PX) return;
      // Don't block taps on the back button itself or anything that
      // explicitly opts out — the synthetic click would never fire
      // otherwise.
      const target = e.target as Element | null;
      if (
        target?.closest('[aria-label="Back"], [data-swipe-passthrough]')
      ) {
        return;
      }
      tracking = true;
      startX = t.clientX;
      startY = t.clientY;
      // Eagerly claim the gesture before iOS commits to swipe-back.
      e.preventDefault();
    }

    function onMove(e: TouchEvent) {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Vertical scroll wins → abandon and let the browser scroll.
      if (Math.abs(dy) > Math.abs(dx) * 1.5) {
        tracking = false;
        return;
      }
      if (dx > CLAIM_DX) {
        e.preventDefault();
      }
    }

    function onEnd(e: TouchEvent) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (
        dx > MIN_DELTA_X &&
        Math.abs(dy) < dx * MAX_VERTICAL_RATIO &&
        handlerRef.current
      ) {
        handlerRef.current();
      }
    }

    function onCancel() {
      tracking = false;
    }

    window.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onCancel);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, []);
}
