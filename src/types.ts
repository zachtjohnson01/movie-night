export type Movie = {
  title: string;
  commonSenseAge: string | null;
  commonSenseScore: string | null;
  rottenTomatoes: string | null;
  imdb: string | null;
  /**
   * Whether this movie has been watched at all. Independent from
   * `dateWatched` so we can record "we watched this, don't remember when".
   */
  watched: boolean;
  dateWatched: string | null; // ISO YYYY-MM-DD, or null if the date is unknown
  notes: string | null;
};
