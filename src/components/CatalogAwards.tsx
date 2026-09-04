import { summarizeCatalogAwards, type CatalogAwardFilm } from '../catalogAwards';

/** Aggregates movie-level awards, never a creator's personal career awards. */
export default function CatalogAwards({ films }: { films: CatalogAwardFilm[] }) {
  const totals = summarizeCatalogAwards(films);
  if (!totals.totalFilms) return null;
  return <aside className="mb-4 rounded-xl border border-amber-glow/20 bg-amber-glow/5 px-3 py-2.5">
    <p className="text-xs font-semibold text-amber-glow">Film awards in these results</p>
    {totals.recordedFilms > 0 && <p className="mt-1 text-sm text-ink-100">{totals.wins} {totals.wins === 1 ? 'win' : 'wins'} · {totals.nominations} {totals.nominations === 1 ? 'nomination' : 'nominations'}</p>}
    <p className="mt-1 text-xs text-ink-400">{totals.recordedFilms > 0 ? `Recorded totals from ${totals.recordedFilms} ${totals.recordedFilms === 1 ? 'film' : 'films'}` : 'No clear recorded totals'}{totals.unknownFilms > 0 ? `; ${totals.unknownFilms} missing or unclear` : ''}.</p>
  </aside>;
}
