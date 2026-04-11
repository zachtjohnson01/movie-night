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
  // for autocomplete-style lookups).
  const data = await omdbGet<OmdbSearchResponse>({ s: trimmed, type: 'movie' });
  if (data.Response === 'True') {
    return data.Search.map((r) => ({
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
    const detail = await omdbGet<OmdbDetailResponse>({ t: trimmed });
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
 * Find a movie on OMDB by title and return its full patch. Used by the
 * bulk-link flow. Tries `?s=` broad search first, takes the top result,
 * then fetches the full detail response via `?i=`. Returns null if no
 * match is found (not an error — the caller iterates over many titles
 * and wants to skip unmatched ones gracefully).
 */
export async function linkByTitle(
  title: string,
): Promise<OmdbMoviePatch | null> {
  const results = await searchMovies(title);
  if (results.length === 0) return null;
  const top = results[0];
  try {
    return await getMovieById(top.imdbId);
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
  };
}

// --- Source URL helpers ---

function titleQuery(title: string): string {
  return encodeURIComponent(title.trim());
}

/**
 * IMDb URL — deep link to the title page if we have an imdbId, otherwise
 * fall back to IMDb's find-by-title search.
 */
export function imdbUrl(movie: Pick<Movie, 'title' | 'imdbId'>): string {
  if (movie.imdbId) return `https://www.imdb.com/title/${movie.imdbId}/`;
  return `https://www.imdb.com/find/?q=${titleQuery(movie.title)}&s=tt&ttype=ft`;
}

/**
 * Rotten Tomatoes URL — always a search URL. OMDB doesn't expose the RT
 * title page URL directly (the `tomatoURL` field was removed years ago),
 * and RT's slug format is inconsistent enough that guessing it is worse
 * than just searching.
 */
export function rottenTomatoesUrl(movie: Pick<Movie, 'title'>): string {
  return `https://www.rottentomatoes.com/search?search=${titleQuery(movie.title)}`;
}

/** Common Sense Media search URL. No deep link available without scraping. */
export function commonSenseUrl(movie: Pick<Movie, 'title'>): string {
  return `https://www.commonsensemedia.org/search/${titleQuery(movie.title)}`;
}
