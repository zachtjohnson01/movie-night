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
  /**
   * Awards string from OMDB (e.g. "Won 1 Oscar. 14 wins & 13 nominations.").
   * Null for manually-entered movies and older rows that predate the field.
   */
  awards: string | null;
  /**
   * Production company from OMDB. Frequently "N/A" on the free tier, so
   * expect this to be sparse. Null for manually-entered movies.
   */
  production: string | null;
  /**
   * User-assigned sort position on the Wishlist tab. Lower values come
   * first. Null means "no explicit order" — those rows fall to the bottom
   * of the list and sort alphabetically among themselves. Populated by the
   * Wishlist's Reorder mode, which rewrites all currently displayed items
   * with consecutive integers so the order is deterministic. Watched
   * movies ignore this field entirely (Watched sorts by dateWatched).
   */
  wishlistOrder: number | null;
};

/**
 * An entry in the deterministic recommendation pool. Not a Movie — these are
 * films the user hasn't added to their library yet. The pool is persisted as
 * a JSONB blob in Supabase (row id=2 in `movie_night`) and grown by the
 * admin-only "Expand pool" action. Ranking is a pure function over this shape.
 */
export type Candidate = {
  title: string;
  year: number | null;
  imdbId: string | null;
  imdb: string | null;
  rottenTomatoes: string | null;
  commonSenseAge: string | null;
  studio: string | null;
  awards: string | null;
  poster: string | null;
  addedAt: string; // ISO timestamp — when this candidate was added to the pool
  /**
   * Admin-set soft veto. When true, `scoreCandidate` applies a large
   * penalty so this candidate ranks below every non-downvoted one in the
   * user-facing top-20. Optional/nullable so older pool rows parse as
   * "not downvoted" without a migration.
   */
  downvoted?: boolean | null;
  /**
   * OMDB Type classification ("movie" | "series" | "episode") when we've
   * been able to resolve it. Populated at enrichment time. Optional so
   * older rows parse as "unknown" without a migration; the TV-show filter
   * in PoolAdmin treats any non-"movie" value as a flag.
   */
  type?: string | null;
  /**
   * Admin-set soft delete. When set, the candidate is still in the pool
   * blob (so `expandPool` keeps it on the ban list and won't re-seed the
   * same title) but `rankTopPicks` filters it out of For You. The reason
   * string is free text, pulled from a vocabulary persisted in row id=3
   * so typed reasons become reusable checkboxes on the next candidate.
   */
  removedReason?: string | null;
  removedAt?: string | null;
};
