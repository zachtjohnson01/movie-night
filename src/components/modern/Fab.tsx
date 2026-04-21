import { AMBER } from './palette';

type Props = {
  onClick: () => void;
  label?: string;
};

/*
 * Floating amber "+" button used on Watched and Wishlist in the modern
 * design. Positioned above the glass tab bar (~104px from bottom of the
 * viewport so it clears both the pill and the safe-area inset).
 */
export default function Fab({ onClick, label = 'Add movie' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        position: 'fixed',
        right: 20,
        bottom: 'calc(env(safe-area-inset-bottom) + 92px)',
        zIndex: 25,
        width: 54,
        height: 54,
        borderRadius: 999,
        background: AMBER,
        color: '#1a1a1a',
        border: 'none',
        boxShadow: `0 10px 24px ${AMBER}55, 0 0 0 6px rgba(245,165,36,0.08)`,
        fontSize: 28,
        fontWeight: 700,
        cursor: 'pointer',
        lineHeight: 1,
      }}
    >
      ＋
    </button>
  );
}
