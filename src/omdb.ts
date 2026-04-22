import type { Movie } from './types';

const OMDB_BASE = 'https://www.omdbapi.com/';
const OMDB_KEY = import.meta.env.VITE_OMDB_API_KEY;

export const isOmdbConfigured = Boolean(OMDB_KEY);

// --- Search results (from the `?s=` endpoint) ---

export type OmdbSearchResult = {
  imdbId: string; // "tt0096283"
  title: string;
  year: string; // "1988" — OMDB returns this as a string, sometimes a range
  type: string; // "movie", "series", etc.
  poster: string | null; // URL or null if OMDB returns "N/A"
};

type OmdbSearchResponse =
  | {
      Response: 'True';
      Search: Array<{
        Title: string;
        Year: string;
        imdbID: string;
        Type: string;
        Poster: string;
      }>;
      totalResults: string;
    }
  | { Response: 'False'; Error: string };

// --- Full movie details (from the `?i=` endpoint) ---

type OmdbDetailResponse =
  | {
      Response: 'True';
      Title: string;
      Year: string;
      imdbID: string;
      imdbRating: string; // "8.2" or "N/A"
      Ratings: Array<{ Source: string; Value: string }>;
      Poster: string;
      Awards: string; // "Won 1 Oscar. Another 14 wins & 13 nominations." or "N/A"
      Production: string; // often "N/A" on the free tier
      Type: string; // "movie", "series", "episode"
    }
  | { Response: 'False'; Error: string };

/**
 * Fragments of a Movie that OMDB can fill in. Used to merge OMDB data on top
 * of existing state without clobbering user-entered fields like notes, dates,
 * or the Common Sense age (which OMDB doesn't know about).
 */
export type OmdbMoviePatch = {
  title: string;
  imdbId: string;
  year: number | null;
  imdb: string | null;
  rottenTomatoes: string | null;
  poster: string | null;
  awards: string | null;
  production: string | null;
};

export class OmdbError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'not-configured'
      | 'not-found'
      | 'network'
      | 'unknown',
  ) {
    super(message);
    this.name = 'OmdbError';
  }
}

async function omdbGet<T>(params: Record<string, string>): Promise<T> {
  if (!OMDB_KEY) {
    throw new OmdbError(
      'OMDB API key not configured. Add VITE_OMDB_API_KEY in Vercel.',
      'not-configured',
    );
  }
  const qs = new URLSearchParams({ apikey: OMDB_KEY, ...params });
  const url = `${OMDB_BASE}?${qs.toString()}`;
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (e) {
    throw new OmdbError(
      `Network error reaching OMDB: ${(e as Error).message}`,
      'network',
    );
  }
  if (!resp.ok) {
    throw new OmdbError(
      `OMDB returned HTTP ${resp.status}`,
      resp.status === 401 ? 'not-configured' : 'network',
    );
  }
  return (await resp.json()) as T;
}

/** Search OMDB for movies matching `query`. Returns up to 10 results. */
export async function searchMovies(query: string): Promise<OmdbSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  // First try the `?s=` broad search (returns up to 10 matches, good
  // for autocomplete-style lookups). `type: 'movie'` constrains OMDB
  // to films, and we re-filter the response as belt-and-suspenders.
  const data = await omdbGet<OmdbSearchResponse>({ s: trimmed, type: 'movie' });
  if (data.Response === 'True') {
    return data.Search
      .filter((r) => r.Type === 'movie')
      .map((r) => ({
        imdbId: r.imdbID,
        title: r.Title,
        year: r.Year,
        type: r.Type,
        poster: r.Poster && r.Poster !== 'N/A' ? r.Poster : null,
      }));
  }

  // `?s=` returned nothing. Fall back to `?t=` — OMDB's "find this
  // specific title" endpoint, which is much more forgiving about
  // punctuation. "A Bugs Life" won't substring-match "A Bug's Life"
  // via `?s=`, but `?t=A Bugs Life` does usually return the right
  // movie. Wrap the single result in an array so callers see the
  // same shape regardless of which endpoint found it.
  try {
    const detail = await omdbGet<OmdbDetailResponse>({ t: trimmed, type: 'movie' });
    if (detail.Response === 'True') {
      return [
        {
          imdbId: detail.imdbID,
          title: detail.Title,
          year: detail.Year,
          type: 'movie',
          poster:
            detail.Poster && detail.Poster !== 'N/A' ? detail.Poster : null,
        },
      ];
    }
  } catch {
    // Fallback failed too — fall through and return empty.
  }
  return [];
}

/** Fetch full movie details by IMDb ID. */
export async function getMovieById(imdbId: string): Promise<OmdbMoviePatch> {
  const data = await omdbGet<OmdbDetailResponse>({ i: imdbId });
  if (data.Response === 'False') {
    throw new OmdbError(data.Error || 'Movie not found', 'not-found');
  }
  return extractPatch(data);
}

/**
 * Look up an IMDb ID and return OMDB's Type classification
 * ("movie" | "series" | "episode"). Returns null on any error or
 * unknown id — callers treat null as "can't confirm, don't destructively
 * act on this entry" so a transient 401/network blip doesn't delete
 * legitimate pool items.
 */
export async function getOmdbTypeById(imdbId: string): Promise<string | null> {
  try {
    const data = await omdbGet<OmdbDetailResponse>({ i: imdbId });
    if (data.Response === 'False') return null;
    return data.Type ?? null;
  } catch {
    return null;
  }
}

/**
 * Decide whether an OMDB search result's title is "close enough" to
 * what the user typed to be trusted as an auto-match. Used by the
 * bulk-link flow to reject obvious mismatches like "Dog Man" →
 * "Man Bites Dog" where OMDB's relevance ranking happened to put an
 * unrelated film at the top.
 *
 * Rules after normalization (lowercase, apostrophes stripped, other
 * punctuation → space, whitespace collapsed):
 * 1. Exact equality → match
 * 2. Either title is a contiguous whole-word substring of the other →
 *    match (so "Totoro" matches "My Neighbor Totoro", and
 *    "The Dark Knight" matches "Dark Knight")
 * 3. Otherwise → reject
 */
export function isCloseMatch(userTitle: string, omdbTitle: string): boolean {
  const user = normalizeTitle(userTitle);
  const omdb = normalizeTitle(omdbTitle);
  if (!user || !omdb) return false;
  if (user === omdb) return true;
  const paddedUser = ` ${user} `;
  const paddedOmdb = ` ${omdb} `;
  return paddedOmdb.includes(paddedUser) || paddedUser.includes(paddedOmdb);
}

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '') // curly + straight apostrophes → gone
    .replace(/[^a-z0-9\s]/g, ' ') // other punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find a movie on OMDB by title and return its full patch. Used by the
 * bulk-link flow. Tries `?s=` broad search first, takes the top result,
 * then fetches the full detail response via `?i=`. Returns null if no
 * match is found or the top result isn't a close enough match to the
 * input title (not an error — the caller iterates over many titles and
 * wants to skip unmatched ones gracefully).
 */
export async function linkByTitle(
  title: string,
): Promise<OmdbMoviePatch | null> {
  const results = await searchMovies(title);
  if (results.length === 0) return null;
  const top = results[0];
  // Reject obviously-wrong matches. Prevents Dog Man → Man Bites Dog.
  if (!isCloseMatch(title, top.title)) return null;
  try {
    return await getMovieById(top.imdbId);
  } catch {
    return null;
  }
}

/**
 * Authoritative-fields patch for a candidate-pool entry. The LLM seeds
 * titles with guesses at RT/IMDb/studio/awards; this function overlays
 * the real values from OMDB where available. Swallows all errors —
 * callers iterate over 100+ titles and want failures to degrade to
 * "leave the LLM guess alone" rather than abort the batch.
 */
export type CandidateOmdbPatch = {
  imdbId: string;
  year: number | null;
  imdb: string | null;
  rottenTomatoes: string | null;
  poster: string | null;
  awards: string | null;
  production: string | null;
};

export async function enrichCandidate(
  title: string,
): Promise<CandidateOmdbPatch | null> {
  if (!OMDB_KEY) return null;
  try {
    const patch = await linkByTitle(title);
    if (!patch) return null;
    return {
      imdbId: patch.imdbId,
      year: patch.year,
      imdb: patch.imdb,
      rottenTomatoes: patch.rottenTomatoes,
      poster: patch.poster,
      awards: patch.awards,
      production: patch.production,
    };
  } catch {
    return null;
  }
}

function extractPatch(data: {
  Title: string;
  Year: string;
  imdbID: string;
  imdbRating: string;
  Ratings: Array<{ Source: string; Value: string }>;
  Poster: string;
  Awards?: string;
  Production?: string;
}): OmdbMoviePatch {
  const rt = data.Ratings.find((r) => r.Source === 'Rotten Tomatoes');
  const year = parseInt(data.Year, 10);
  return {
    title: data.Title,
    imdbId: data.imdbID,
    year: Number.isFinite(year) ? year : null,
    imdb: data.imdbRating && data.imdbRating !== 'N/A' ? data.imdbRating : null,
    rottenTomatoes: rt ? rt.Value : null,
    poster: data.Poster && data.Poster !== 'N/A' ? data.Poster : null,
    awards: data.Awards && data.Awards !== 'N/A' ? data.Awards : null,
    production: data.Production && data.Production !== 'N/A' ? data.Production : null,
  };
}

// --- Source URL helpers ---

function titleQuery(title: string): string {
  return encodeURIComponent(title.trim());
}

/**
 * Resolve the title we should use when searching a third-party source
 * like RT or CSM. Prefers the `displayTitle` override so foreign-origin
 * films linked to their IMDb original-language entry still find the
 * right regional page (e.g., "Lotte from Gadgetville" instead of
 * "Leiutajateküla Lotte").
 */
function searchTitle(
  movie: Pick<Movie, 'title' | 'displayTitle'>,
): string {
  const override = movie.displayTitle?.trim();
  return override || movie.title;
}

/**
 * IMDb URL — deep link to the title page if we have an imdbId, otherwise
 * fall back to IMDb's find-by-title search using the display title.
 */
export function imdbUrl(
  movie: Pick<Movie, 'title' | 'displayTitle' | 'imdbId'>,
): string {
  if (movie.imdbId) return `https://www.imdb.com/title/${movie.imdbId}/`;
  return `https://www.imdb.com/find/?q=${titleQuery(searchTitle(movie))}&s=tt&ttype=ft`;
}

/**
 * Rotten Tomatoes URL — always a search URL. OMDB doesn't expose the RT
 * title page URL directly (the `tomatoURL` field was removed years ago),
 * and RT's slug format is inconsistent enough that guessing it is worse
 * than just searching. Uses `displayTitle` when set so the search lands
 * on the regional release page instead of the original-language title.
 */
export function rottenTomatoesUrl(
  movie: Pick<Movie, 'title' | 'displayTitle'>,
): string {
  return `https://www.rottentomatoes.com/search?search=${titleQuery(searchTitle(movie))}`;
}

/**
 * Common Sense Media search URL. No deep link available without
 * scraping. Uses `displayTitle` when set, same rationale as RT.
 */
export function commonSenseUrl(
  movie: Pick<Movie, 'title' | 'displayTitle'>,
): string {
  return `https://www.commonsensemedia.org/search/${titleQuery(searchTitle(movie))}`;
}
