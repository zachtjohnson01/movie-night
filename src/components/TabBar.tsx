export type Tab = 'watched' | 'wishlist' | 'recs';

type Props = {
  tab: Tab;
  onChange: (tab: Tab) => void;
};

export default function TabBar({ tab, onChange }: Props) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-20 border-t border-ink-800 bg-ink-950/90 backdrop-blur supports-[backdrop-filter]:bg-ink-950/75"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto max-w-xl grid grid-cols-3">
        <TabButton
          label="Watched"
          active={tab === 'watched'}
          onClick={() => onChange('watched')}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
              aria-hidden
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          }
        />
        <TabButton
          label="Wishlist"
          active={tab === 'wishlist'}
          onClick={() => onChange('wishlist')}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
              aria-hidden
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          }
        />
        <TabButton
          label="For you"
          active={tab === 'recs'}
          onClick={() => onChange('recs')}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
              aria-hidden
            >
              <path d="M12 3l2.09 5.26L20 9.27l-4 3.9L17.18 19 12 16.27 6.82 19 8 13.17l-4-3.9 5.91-1.01L12 3z" />
            </svg>
          }
        />
      </div>
    </nav>
  );
}

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 min-h-[64px] py-3 text-xs font-medium transition-colors ${
        active ? 'text-amber-glow' : 'text-ink-400 active:text-ink-200'
      }`}
      aria-pressed={active}
    >
      {icon}
      <span className="tracking-wide uppercase">{label}</span>
    </button>
  );
}
