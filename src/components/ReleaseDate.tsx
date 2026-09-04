import { parseReleaseDate, releaseDateLabel } from '../releaseDate';

/** OMDB dates do not promise regional availability. */
export default function ReleaseDate({ releaseDate, compact = false }: { releaseDate?: string | null; compact?: boolean }) {
  const label = releaseDateLabel(releaseDate);
  if (!label) return null;
  if (compact) {
    const date = parseReleaseDate(releaseDate)!;
    const [year, month, day] = date.split('-').map(Number);
    const short = `${month}/${day}/${String(year).slice(-2)}`;
    return <span aria-label={label} title={`${label}. Availability varies by region and service.`} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] leading-none text-ink-400">
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>
      <time dateTime={date}>{short}</time>
    </span>;
  }
  return <p className="text-xs text-ink-300 my-2" title="Release date reported by OMDB; availability varies by region and service.">{label}</p>;
}
