import type { FamilySummary } from '../useFamilies';
import { pathFromRoute, pushPath } from '../router';

type Props = {
  family: FamilySummary;
  /**
   * `yours` adds an amber-glow accent border and `(yours)` tag — used
   * for the signed-in user's own families. `directory` is the neutral
   * card used everywhere else.
   */
  variant?: 'directory' | 'yours';
  /**
   * Up to 3 poster URLs to render as a small decorative strip on the
   * right edge of the card. Empty array (or shorter than 3) hides the
   * strip on mobile and renders only what's available on wider widths.
   */
  posters?: string[];
};

/**
 * Tappable card on the landing / families directory pages. Renders as
 * a real `<a>` so right-click → open in new tab still works, but
 * intercepts left clicks to keep navigation client-side.
 */
export default function FamilyCard({
  family,
  variant = 'directory',
  posters = [],
}: Props) {
  const href = pathFromRoute({ kind: 'family', slug: family.slug });
  const isYours = variant === 'yours';
  const trimmedPosters = posters.filter(Boolean).slice(0, 3);
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
      className={
        'block w-full rounded-2xl px-5 py-4 active:bg-ink-800/70 ' +
        (isYours
          ? 'bg-ink-900 border border-amber-glow/30 active:border-amber-glow/50'
          : 'bg-ink-900 border border-ink-800 active:border-ink-700')
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="text-lg font-semibold text-ink-100 leading-tight">
              {family.name}
            </div>
            {isYours && (
              <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-glow">
                Yours
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-ink-500 uppercase tracking-[0.18em]">
            /{family.slug}
          </div>
          <div className="mt-3 flex items-center gap-3 text-sm text-ink-300">
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
        </div>
        {trimmedPosters.length > 0 && (
          <div
            className="shrink-0 flex items-center gap-1.5"
            aria-hidden="true"
          >
            {trimmedPosters.map((url, i) => (
              <div
                key={url + i}
                className="w-10 aspect-[2/3] rounded-md bg-ink-800 border border-ink-700/60 bg-cover bg-center"
                style={{ backgroundImage: `url("${url}")` }}
              />
            ))}
          </div>
        )}
      </div>
    </a>
  );
}
