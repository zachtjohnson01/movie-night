import { getDisplayTitle } from '../format';
import type { Movie } from '../types';

type Size = 'thumb' | 'detail';

const SIZE_CLASS: Record<Size, string> = {
  // 48x72, 2:3 aspect — used on list rows
  thumb: 'w-12 h-[72px] rounded-md',
  // 96x144, 2:3 aspect — used on the Detail screen
  detail: 'w-24 h-36 rounded-xl',
};

const PLACEHOLDER_TEXT_CLASS: Record<Size, string> = {
  thumb: 'text-lg',
  detail: 'text-4xl',
};

type Props = {
  movie: Pick<Movie, 'title' | 'displayTitle' | 'poster'>;
  size?: Size;
};

/**
 * Movie poster thumbnail with a graceful placeholder fallback when the
 * poster URL is missing (manually-entered movies that haven't been
 * linked to OMDB yet). The placeholder shows the title's first letter
 * on a dark card so rows without posters don't look broken.
 */
export default function MoviePoster({ movie, size = 'thumb' }: Props) {
  const sizeClass = SIZE_CLASS[size];

  if (movie.poster) {
    return (
      <img
        src={movie.poster}
        alt=""
        loading="lazy"
        className={`shrink-0 ${sizeClass} object-cover bg-ink-800 border border-ink-800`}
      />
    );
  }

  const initial = getDisplayTitle(movie).trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      className={`shrink-0 ${sizeClass} bg-ink-800 border border-ink-700 flex items-center justify-center`}
      aria-hidden
    >
      <span
        className={`${PLACEHOLDER_TEXT_CLASS[size]} font-bold text-ink-600 select-none`}
      >
        {initial}
      </span>
    </div>
  );
}
