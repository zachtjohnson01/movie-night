export type Movie = {
  title: string;
  /**
   * Optional user override for how the movie is rendered in the UI.
   * OMDB returns IMDb's primary-language title, which is often the
   * original language (e.g., "Leiutajateküla Lotte" for the Estonian
   * animated film whose English release is "Lotte from Gadgetville").
   * When `displayTitle` is set, it's used everywhere a human-readable
   * name is shown: list rows, Detail header, RT/CSM search URLs.
   * `title` stays as the OMDB canonical so `imdbId` linking and
   * refresh keep working against the canonical IMDb title.
   */
  displayTitle: string | null;
  commonSenseAge: string | null;
  commonSenseScore: string | null;
  rottenTomatoes: string | null;
  imdb: string | null;
  /**
   * IMDb ID like "tt0096283". Populated when the movie has been linked to
   * OMDB (either via the search combobox when adding, or via the refresh
   * button on an existing movie). Doubles as the "linked/verified" flag:
   * null means the movie was entered manually and isn't tied to a canonical
   * external source yet.
   */
  imdbId: string | null;
  /**
   * Release year, filled in by OMDB. Optional but useful for disambiguating
   * between movies with identical titles.
   */
  year: number | null;
  /**
   * Movie poster URL. Filled in by OMDB when a movie is linked or
   * refreshed. Null for manually-entered movies — the UI shows a
   * placeholder in that case.
   */
  poster: string | null;
  /**
   * ISO timestamp of the last successful OMDB fetch (link or refresh).
   * Null if the movie has never been linked. Used to show "last
   * refreshed N minutes ago" on the Detail screen.
   */
  omdbRefreshedAt: string | null;
  /**
   * Whether this movie has been watched at all. Independent from
   * `dateWatched` so we can record "we watched this, don't remember when".
   */
  watched: boolean;
  dateWatched: string | null; // ISO YYYY-MM-DD, or null if the date is unknown
  notes: string | null;
};
