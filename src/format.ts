import type { Movie } from './types';

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

/** Prefer RT %, fall back to IMDb, fall back to null. */
export function primaryScore(m: Movie): string | null {
  if (m.rottenTomatoes) return m.rottenTomatoes;
  if (m.imdb) return m.imdb;
  return null;
}

/**
 * Find the earliest watched date among a list of movies.
 * Returns an ISO string or null if nothing is watched.
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
