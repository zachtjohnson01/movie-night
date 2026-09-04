import { releaseDateLabel } from '../releaseDate';

/** OMDB release date is not a promise of a particular region or release window. */
export default function ReleaseDate({ releaseDate }: { releaseDate?: string | null }) {
  const label = releaseDateLabel(releaseDate);
  if (!label) return null;
  return <p className="text-xs text-ink-300 my-2" title="Release date reported by OMDB; availability varies by region and service.">{label}</p>;
}
