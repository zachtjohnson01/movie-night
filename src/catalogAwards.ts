export type CatalogAwardFilm = { title: string; year?: number | null; imdbId?: string | null; awards?: string | null };
export type AwardTotals = { wins: number; nominations: number };
export type CatalogAwardsSummary = AwardTotals & { recordedFilms: number; unknownFilms: number; totalFilms: number };

/** Parse explicit OMDB count summaries only. Never add named awards to a stated total. */
export function parseAwardTotals(value: string | null | undefined): AwardTotals | null {
  if (!value || /^(?:n\/a|none|unknown)$/i.test(value.trim())) return null;
  let text = value.trim();
  let oscarWins = 0;
  let oscarNominations = 0;
  const oscar = /^(Won|Nominated for) (\d+) Oscars?\.\s*/i.exec(text);
  if (oscar) {
    if (oscar[1].toLowerCase() === 'won') oscarWins = Number(oscar[2]);
    else oscarNominations = Number(oscar[2]);
    text = text.slice(oscar[0].length);
  }
  const match = /^(Another\s+)?(?:(\d+) wins?(?:\s*&\s*(\d+) nominations?)?|(\d+) nominations?)(\s+total)?\.?$/i.exec(text);
  if (!match) return null;
  const another = !!match[1];
  const total = !!match[5];
  if ((another && (!oscar || total)) || (oscar && !another && !total)) return null;
  const wins = Number(match[2] ?? 0);
  const nominations = Number(match[3] ?? match[4] ?? 0);
  if (![wins, nominations, oscarWins, oscarNominations].every(Number.isSafeInteger)) return null;
  if (oscar && total && (wins < oscarWins || nominations < oscarNominations)) return null;
  return { wins: wins + (another ? oscarWins : 0), nominations: nominations + (another ? oscarNominations : 0) };
}

export function summarizeCatalogAwards(films: CatalogAwardFilm[]): CatalogAwardsSummary {
  const groups = new Map<string, CatalogAwardFilm[]>();
  for (const film of films) {
    const key = film.imdbId?.trim().toLowerCase() || `${film.title.trim().toLowerCase().replace(/\s+/g, ' ')}:${film.year ?? '?'}`;
    groups.set(key, [...(groups.get(key) ?? []), film]);
  }
  const summary: CatalogAwardsSummary = { wins: 0, nominations: 0, recordedFilms: 0, unknownFilms: 0, totalFilms: groups.size };
  for (const group of groups.values()) {
    const totals = group.map(film => parseAwardTotals(film.awards)).filter((value): value is AwardTotals => value !== null);
    const first = totals[0];
    // Conflicting copies are uncertain, not separate contributions or a reason
    // to pick the larger number. A missing copy can use another recorded copy.
    if (!first || totals.some(value => value.wins !== first.wins || value.nominations !== first.nominations)) {
      summary.unknownFilms++;
      continue;
    }
    summary.recordedFilms++;
    summary.wins += first.wins;
    summary.nominations += first.nominations;
  }
  return summary;
}
