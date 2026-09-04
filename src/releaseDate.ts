const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Exact calendar dates only. Never let Date normalize an invalid day/month. */
export function parseReleaseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const omdb = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(value);
  const year = iso ? Number(iso[1]) : omdb ? Number(omdb[3]) : 0;
  const month = iso ? Number(iso[2]) : omdb ? MONTHS.indexOf(omdb[2]) + 1 : 0;
  const day = iso ? Number(iso[3]) : omdb ? Number(omdb[1]) : 0;
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function releaseDateLabel(value: string | null | undefined, now = new Date()): string | null {
  const date = parseReleaseDate(value);
  if (!date) return null;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [year, month, day] = date.split('-').map(Number);
  return `${date > today ? 'Upcoming' : 'Release date'} · ${MONTHS[month - 1]} ${day}, ${year}`;
}
