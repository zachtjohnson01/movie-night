import type { FamilySummary } from '../useFamilies';
import { pathFromRoute, pushPath } from '../router';

type Props = {
  family: FamilySummary;
};

/**
 * Tappable card on the landing page. Renders as a real `<a>` so
 * right-click → open in new tab still works, but intercepts left
 * clicks to keep navigation client-side (avoids a full reload of
 * the SPA bundle).
 */
export default function FamilyCard({ family }: Props) {
  const href = pathFromRoute({ kind: 'family', slug: family.slug });
  return (
    <a
      href={href}
      onClick={(e) => {
        if (
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          e.button !== 0
        ) {
          return;
        }
        e.preventDefault();
        pushPath(href);
      }}
      className="block w-full rounded-2xl bg-ink-900 border border-ink-800 px-5 py-4 active:bg-ink-800/70 active:border-ink-700"
    >
      <div className="text-lg font-semibold text-ink-100 leading-tight">
        {family.name}
      </div>
      <div className="mt-1 text-xs text-ink-500 uppercase tracking-[0.18em]">
        /{family.slug}
      </div>
      <div className="mt-3 flex items-center gap-4 text-sm text-ink-300">
        <span>
          <span className="font-semibold text-ink-100 tabular-nums">
            {family.watchedCount}
          </span>{' '}
          watched
        </span>
        <span className="text-ink-700">·</span>
        <span>
          <span className="font-semibold text-ink-100 tabular-nums">
            {family.wishlistCount}
          </span>{' '}
          up next
        </span>
      </div>
    </a>
  );
}
