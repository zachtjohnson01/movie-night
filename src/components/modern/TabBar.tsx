import type { Tab } from '../TabBar';
import { AMBER, BORDER, INK_2, SANS } from './palette';

type Props = {
  tab: Tab;
  onChange: (tab: Tab) => void;
};

/*
 * Floating glass pill tab bar. Sits above content (not in the normal flow)
 * so the underlying page can scroll behind it. Respects the iPhone bottom
 * safe-area inset via CSS env().
 */
export default function TabBar({ tab, onChange }: Props) {
  const items: { id: Tab; label: string; icon: string }[] = [
    { id: 'watched', label: 'Watched', icon: '▶' },
    { id: 'wishlist', label: 'Up Next', icon: '✦' },
    { id: 'recs', label: 'For you', icon: '✨' },
  ];
  return (
    <nav
      aria-label="Primary"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(env(safe-area-inset-bottom) + 16px)',
        zIndex: 30,
        background: 'rgba(26,26,38,0.78)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: `1px solid ${BORDER}`,
        borderRadius: 999,
        padding: 6,
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        maxWidth: 560,
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
    >
      {items.map((it) => {
        const on = tab === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            aria-pressed={on}
            style={{
              flex: 1,
              minHeight: 44,
              padding: '10px 10px',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              background: on ? AMBER : 'transparent',
              color: on ? '#1a1a1a' : INK_2,
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: -0.1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <span aria-hidden>{it.icon}</span>
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}
