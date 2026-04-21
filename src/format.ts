import type { Candidate, Movie } from './types';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Format an ISO YYYY-MM-DD date as "MMM d, yyyy" without relying on the host
 * timezone (which would shift the day for pure-date strings).
 */
export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

export function formatMonthYear(iso: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!match) return '';
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** Return today's date as ISO YYYY-MM-DD in the user's local timezone. */
export function todayIso(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format an ISO 8601 timestamp (e.g. "2026-04-11T09:42:15.000Z") as a
 * short, human-readable relative time. Unlike `formatDate`, this is
 * safe to parse with `new Date()` because a full timestamp is an
 * unambiguous moment in time — the "never use new Date()" rule only
 * applies to pure-date strings like "2024-12-06" which would otherwise
 * get shifted by the local timezone.
 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 0) return 'in the future';
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return '1 minute ago';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 45) return `${diffMin} minutes ago`;
  if (diffMin < 90) return '1 hour ago';
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hours ago`;
  if (diffHr < 48) return 'yesterday';
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} days ago`;
  if (diffDay < 60) return 'last month';
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} months ago`;
  return 'over a year ago';
}

/** Prefer RT %, fall back to IMDb, fall back to null. */
export function primaryScore(m: Movie): string | null {
  if (m.rottenTomatoes) return m.rottenTomatoes;
  if (m.imdb) return m.imdb;
  return null;
}

/**
 * Find the earliest known dateWatched among a list of movies.
 * Returns an ISO string or null if no movie has a known date.
 */
export function earliestWatched(movies: Movie[]): string | null {
  let earliest: string | null = null;
  for (const m of movies) {
    if (!m.dateWatched) continue;
    if (earliest === null || m.dateWatched < earliest) earliest = m.dateWatched;
  }
  return earliest;
}

/**
 * Return the title to show the user for this movie. Prefers the
 * optional `displayTitle` override (used for English releases of
 * foreign-origin films that OMDB stores under the original-language
 * title), and falls back to the canonical `title` otherwise.
 *
 * Use this everywhere a human-readable name appears in the UI: list
 * rows, Detail header, MoviePoster placeholder letter, RT/CSM search
 * URLs, delete confirms, etc. Do NOT use it for OMDB linking — that
 * needs the canonical `title` to match IMDb's primary record.
 */
export function getDisplayTitle(
  movie: Pick<Movie, 'title' | 'displayTitle'>,
): string {
  const override = movie.displayTitle?.trim();
  if (override) return override;
  return movie.title;
}

/**
 * Sort wishlist movies: user-reordered items first (by `wishlistOrder` asc),
 * then items without an explicit order, alphabetically.
 */
export function sortWishlist(movies: Movie[]): Movie[] {
  return [...movies].sort((a, b) => {
    const ao = a.wishlistOrder;
    const bo = b.wishlistOrder;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return getDisplayTitle(a).localeCompare(getDisplayTitle(b), undefined, {
      sensitivity: 'base',
    });
  });
}

/**
 * Sort watched movies: known dates first (newest first), then undated movies
 * alphabetically at the bottom.
 */
export function sortWatched(movies: Movie[]): Movie[] {
  return [...movies].sort((a, b) => {
    if (a.dateWatched && b.dateWatched) {
      return a.dateWatched < b.dateWatched ? 1 : -1;
    }
    if (a.dateWatched) return -1;
    if (b.dateWatched) return 1;
    return getDisplayTitle(a).localeCompare(getDisplayTitle(b), undefined, {
      sensitivity: 'base',
    });
  });
}

/** Produce a fresh, empty Movie with the given `watched` default. */
export function emptyMovie(watched: boolean): Movie {
  return {
    title: '',
    displayTitle: null,
    commonSenseAge: null,
    commonSenseScore: null,
    rottenTomatoes: null,
    imdb: null,
    imdbId: null,
    year: null,
    poster: null,
    omdbRefreshedAt: null,
    watched,
    dateWatched: null,
    notes: null,
    awards: null,
    production: null,
    wishlistOrder: null,
  };
}

export function candidateToTemplate(c: Candidate): Movie {
  return {
    title: c.title,
    displayTitle: null,
    commonSenseAge: c.commonSenseAge,
    commonSenseScore: null,
    rottenTomatoes: c.rottenTomatoes,
    imdb: c.imdb,
    imdbId: c.imdbId,
    year: c.year,
    poster: c.poster,
    omdbRefreshedAt: null,
    watched: false,
    dateWatched: null,
    notes: null,
    awards: c.awards,
    production: c.studio,
    wishlistOrder: null,
  };
}

/**
 * Color for a Common Sense Media age pill. Higher ages get warmer/darker tones.
 */
export function ageBadgeClass(age: string | null): string {
  if (!age) return 'bg-ink-700 text-ink-300 border-ink-600';
  const n = parseInt(age, 10);
  if (Number.isNaN(n))
    return 'bg-ink-700 text-ink-300 border-ink-600';
  if (n <= 4) return 'bg-emerald-900/60 text-emerald-200 border-emerald-700/60';
  if (n <= 6) return 'bg-amber-900/60 text-amber-200 border-amber-700/60';
  if (n <= 8) return 'bg-orange-900/60 text-orange-200 border-orange-700/60';
  return 'bg-rose-900/60 text-rose-200 border-rose-700/60';
}
