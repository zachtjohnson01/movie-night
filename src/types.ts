export type Movie = {
  title: string;
  /**
   * Optional override for how the movie is rendered in the UI.
   * OMDB returns IMDb's primary-language title, which is often the
   * original language (e.g., "Leiutajateküla Lotte" for the Estonian
   * animated film whose English release is "Lotte from Gadgetville").
   * When set, it's used everywhere a human-readable name is shown:
   * list rows, Detail header, RT/CSM search URLs. `title` stays as the
   * OMDB canonical so `imdbId` linking and refresh keep working against
   * the canonical IMDb title. Source of truth lives on Candidate
   * (managed in the Manage pool edit sheet); surfaced here at merge time.
   */
  displayTitle: string | null;
  commonSenseAge: string | null;
  commonSenseScore: string | null;
  rottenTomatoes: string | null;
  /**
   * Rotten Tomatoes URL slug like "toy_story_1995", surfaced from the matching
   * Candidate at merge time. Source of truth lives on Candidate (manually
   * entered in the Manage pool edit sheet); Movie is read-only for this
   * field. When set, `rottenTomatoesUrl()` deep-links to /m/<slug> instead of
   * falling back to a title search.
   */
  rottenTomatoesId: string | null;
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
   * Individual director names, stored as a list so they can be rendered
   * as separate pills. Null until OMDB-linked or manually entered. Empty
   * array is not a valid state — collapse to null when no names remain.
   * Legacy rows in the JSONB blob may still have a `director: string` field;
   * readers coerce it via `parseNameList` in `src/format.ts`.
   */
  directors: string[] | null;
  /** Individual writer names. See `directors` for semantics. */
  writers: string[] | null;
  /**
   * User-assigned sort position on the Wishlist tab. Lower values come
   * first. Null means "no explicit order" — those rows fall to the bottom
   * of the list and sort alphabetically among themselves. Populated by the
   * Wishlist's Reorder mode, which rewrites all currently displayed items
   * with consecutive integers so the order is deterministic. Watched
   * movies ignore this field entirely (Watched sorts by dateWatched).
   */
  wishlistOrder: number | null;
  /**
   * User-set favorite flag. Surfaces as a "Favorites" carousel on the
   * modern Watched view and a small star indicator on full-reel rows.
   * Defaults to false; legacy rows missing the field coerce to false at
   * the merge boundary. The Detail star UI only exposes the toggle for
   * watched movies — favoriting an unseen wishlist item isn't a flow.
   */
  favorite: boolean;
};

/**
 * Thin overlay stored in row id=1. Contains only user-specific data.
 * OMDB metadata lives on Candidate (row id=2) and is merged at render time.
 * The rendered Movie type is produced by mergeEntry(LibraryEntry, Candidate).
 */
export type LibraryEntry = {
  title: string;          // primary join key → Candidate.title
  imdbId: string | null;  // secondary join key (preferred when set)
  commonSenseAge: string | null;
  commonSenseScore: string | null;
  watched: boolean;
  dateWatched: string | null;
  notes: string | null;
  wishlistOrder: number | null;
  favorite: boolean;
};

/**
 * An entry in the deterministic recommendation pool. After the schema split,
 * this also serves as the canonical metadata record for library movies — the
 * pool holds ALL movies (library + pure recommendation candidates). Ranking
 * filters out library movies by title/imdbId match. Persisted as a JSONB blob
 * in Supabase (row id=2 in `movie_night`).
 */
export type Candidate = {
  title: string;
  /**
   * Pool-level human-readable name. OMDB returns IMDb's primary-language
   * title (often non-English, e.g. "Leiutajateküla Lotte"). When set,
   * displayTitle is what the UI renders everywhere a name is shown.
   * `title` stays as the OMDB canonical so `imdbId` linking and refresh
   * keep working. Optional for backward compat with existing pool rows.
   */
  displayTitle?: string | null;
  year: number | null;
  imdbId: string | null;
  imdb: string | null;
  rottenTomatoes: string | null;
  /**
   * Rotten Tomatoes URL slug like "toy_story_1995" (the `/m/<slug>` portion
   * of the RT page). Manually populated in the Manage pool edit sheet —
   * OMDB doesn't expose it. Optional so older pool rows parse as "not set"
   * without a migration. When present, `rottenTomatoesUrl()` deep-links to
   * the RT page instead of falling back to a title search.
   */
  rottenTomatoesId?: string | null;
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
  /**
   * Individual director names. Optional so older rows parse without migration.
   * Legacy rows may have a `director: string` field instead; coerce via
   * `parseNameList` in `src/format.ts` at the read boundary.
   */
  directors?: string[] | null;
  /** Individual writer names. See `directors` for semantics. */
  writers?: string[] | null;
  /** ISO timestamp of the last successful OMDB fetch for this candidate. Optional for backward compat. */
  omdbRefreshedAt?: string | null;
};
