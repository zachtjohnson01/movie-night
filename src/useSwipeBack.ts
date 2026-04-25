import { useEffect, useRef } from 'react';

// Standalone iOS PWAs don't get the native edge-swipe-back gesture,
// and Safari's native edge-swipe will hijack ours unless we claim
// every left-edge touch via preventDefault on touchstart. iOS commits
// to its own gesture early — touchmove preventDefault arrives too
// late once Safari has decided.
//
// Crucially, we must preventDefault even when the touch lands on the
// in-header Back button (which sits inside the EDGE_PX zone). Skipping
// it there left half of all edge swipes unprotected — users naturally
// start swipes on or near the visible Back button, and iOS won the
// gesture race for those. To preserve the Back button's tap, a no-
// movement edge touch whose origin is the Back button is treated as
// a synthetic back action — same destination either way.
const EDGE_PX = 24;
const MIN_DELTA_X = 60;
const MAX_VERTICAL_RATIO = 0.6;
const CLAIM_DX = 8;
// Movement under this counts as a "tap" for back-button passthrough.
const TAP_SLOP_PX = 10;

export function useSwipeBack(onBack: (() => void) | null) {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let originIsBackButton = false;

    function onStart(e: TouchEvent) {
      if (!handlerRef.current) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_PX) return;

      const target = e.target as Element | null;
      originIsBackButton = !!target?.closest(
        '[aria-label="Back"], [data-swipe-passthrough]',
      );

      tracking = true;
      startX = t.clientX;
      startY = t.clientY;
      // Always claim the gesture before iOS commits to swipe-back.
      // The synthetic click that would have fired on the Back button
      // is replaced by the back action we run from onEnd below.
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
      const wasBackButton = originIsBackButton;
      originIsBackButton = false;

      const isSwipeBack =
        dx > MIN_DELTA_X && Math.abs(dy) < dx * MAX_VERTICAL_RATIO;
      const isBackButtonTap =
        wasBackButton &&
        Math.abs(dx) < TAP_SLOP_PX &&
        Math.abs(dy) < TAP_SLOP_PX;

      if ((isSwipeBack || isBackButtonTap) && handlerRef.current) {
        handlerRef.current();
      }
    }

    function onCancel() {
      tracking = false;
      originIsBackButton = false;
    }

    // capture: true so we run before any other listener that might
    // call stopPropagation (e.g. the in-page combobox dismissers).
    const opts = { passive: false, capture: true } as const;
    window.addEventListener('touchstart', onStart, opts);
    window.addEventListener('touchmove', onMove, opts);
    window.addEventListener('touchend', onEnd, { capture: true });
    window.addEventListener('touchcancel', onCancel, { capture: true });
    return () => {
      window.removeEventListener('touchstart', onStart, opts);
      window.removeEventListener('touchmove', onMove, opts);
      window.removeEventListener('touchend', onEnd, { capture: true });
      window.removeEventListener('touchcancel', onCancel, { capture: true });
    };
  }, []);
}
