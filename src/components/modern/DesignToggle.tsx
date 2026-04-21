import { AMBER, BORDER, INK_3, SANS } from './palette';

type Props = {
  design: 'classic' | 'modern';
  onToggle: () => void;
};

/*
 * Small pill that swaps between the classic UI and the Modern Marquee
 * design. Visible in the headers of both Watched and Wishlist so it's
 * always reachable. Label flips depending on the current design.
 */
export default function DesignToggle({ design, onToggle }: Props) {
  const isModern = design === 'modern';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isModern ? 'Back to classic design' : 'Try new design'}
      style={{
        minHeight: 32,
        padding: '6px 12px',
        borderRadius: 999,
        fontFamily: SANS,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        color: isModern ? '#1a1a1a' : INK_3,
        background: isModern ? AMBER : 'transparent',
        border: isModern ? '1px solid transparent' : `1px solid ${BORDER}`,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {isModern ? 'Classic design' : 'Try new design'}
    </button>
  );
}
