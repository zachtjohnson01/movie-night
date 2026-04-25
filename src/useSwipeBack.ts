import { useEffect, useRef } from 'react';

// Standalone iOS PWAs don't get the native edge-swipe-back gesture,
// and Safari's native edge-swipe will hijack ours unless we actively
// claim it via preventDefault on the first horizontally-dominant
// touchmove. We listen with passive: false on touchmove so the
// preventDefault actually suppresses the system gesture.
const EDGE_PX = 24;
const MIN_DELTA_X = 60;
const MAX_VERTICAL_RATIO = 0.6;
// Once horizontal travel exceeds this, claim the gesture by calling
// preventDefault. Smaller than MIN_DELTA_X so we win before iOS's
// gesture engine commits to its own swipe-back.
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
      tracking = true;
      startX = t.clientX;
      startY = t.clientY;
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
      // Horizontally-dominant rightward motion → claim the gesture.
      if (dx > CLAIM_DX && Math.abs(dy) < dx) {
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

    // touchstart stays passive — we never preventDefault there, which
    // would break taps near the screen edge (e.g. the in-header Back
    // button at left padding ~8px).
    window.addEventListener('touchstart', onStart, { passive: true });
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
