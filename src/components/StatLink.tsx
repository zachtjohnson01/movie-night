import { ageBadgeClass } from '../format';

export default function StatLink({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: string | null;
  href: string;
  accent?: 'age';
}) {
  const pillClass =
    accent === 'age' && value
      ? ageBadgeClass(value)
      : 'bg-ink-800 border-ink-700 text-ink-100';
  // Make the whole card tappable. Even when `value` is null we still link
  // out so the user can look it up at the source and fill it in manually.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-2xl bg-ink-900/70 border border-ink-800 p-3 active:bg-ink-800/80 transition-colors"
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 font-semibold">
        {label}
      </div>
      <div className="mt-2">
        {value ? (
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold tabular-nums ${pillClass}`}
          >
            {value}
          </span>
        ) : (
          <span className="text-ink-500 text-sm italic">Look up ↗</span>
        )}
      </div>
    </a>
  );
}
