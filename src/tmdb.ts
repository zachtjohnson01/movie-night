import type { StreamingInfo, StreamingProvider } from './types';

// TMDB's "Watch Providers" endpoint is powered by a JustWatch partnership.
// It tells us WHICH services carry a title in a given country (stream / rent /
// buy) but, per TMDB's agreement with JustWatch, it does NOT expose a deep
// link straight into each provider's app. The only link it returns is a single
// per-country JustWatch-powered TMDB watch page. So every provider tile links
// to that same page, where the user picks the service — that page in turn
// hands off to the service's app (via universal links) on mobile, or the
// website on desktop. JustWatch attribution is required when displaying this.
//
// OMDB has no streaming data at all (see src/omdb.ts), hence this second API.

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w92';
const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;

// Country we resolve availability for. The family is US-based; TMDB keys
// availability by ISO-3166-1 country code and returns nothing for regions
// without data.
export const STREAMING_REGION = 'US';

export const isTmdbConfigured = Boolean(TMDB_KEY);

export class TmdbError extends Error {
  constructor(
    message: string,
    public readonly kind: 'not-configured' | 'not-found' | 'network' | 'unknown',
  ) {
    super(message);
    this.name = 'TmdbError';
  }
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!TMDB_KEY) {
    throw new TmdbError(
      'TMDB API key not configured. Add VITE_TMDB_API_KEY in Vercel.',
      'not-configured',
    );
  }
  const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params });
  let resp: Response;
  try {
    resp = await fetch(`${TMDB_BASE}${path}?${qs.toString()}`);
  } catch (e) {
    throw new TmdbError(
      `Network error reaching TMDB: ${(e as Error).message}`,
      'network',
    );
  }
  if (!resp.ok) {
    throw new TmdbError(
      `TMDB returned HTTP ${resp.status}`,
      resp.status === 401 ? 'not-configured' : 'network',
    );
  }
  return (await resp.json()) as T;
}

type FindResponse = {
  movie_results?: Array<{ id: number }>;
};

type ProviderEntry = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
};

type WatchProvidersResponse = {
  results?: Record<
    string,
    {
      link?: string;
      flatrate?: ProviderEntry[];
      free?: ProviderEntry[];
      ads?: ProviderEntry[];
      rent?: ProviderEntry[];
      buy?: ProviderEntry[];
    }
  >;
};

function mapProviders(entries: ProviderEntry[] | undefined): StreamingProvider[] {
  if (!entries) return [];
  // TMDB returns providers pre-sorted by display_priority; preserve that
  // order and dedupe by id (free/ads/flatrate can overlap once merged).
  const seen = new Set<number>();
  const out: StreamingProvider[] = [];
  for (const e of entries) {
    if (seen.has(e.provider_id)) continue;
    seen.add(e.provider_id);
    out.push({
      id: e.provider_id,
      name: e.provider_name,
      logo: e.logo_path ? `${TMDB_IMG_BASE}${e.logo_path}` : null,
    });
  }
  return out;
}

/**
 * Resolve where a movie is available to watch in {@link STREAMING_REGION}.
 *
 * Maps the IMDb ID to TMDB's internal movie id, then fetches watch providers.
 * Returns a {@link StreamingInfo} (always — with empty arrays when nothing is
 * available, so callers can cache "we checked and found nothing" and not refetch
 * every open). Throws {@link TmdbError} only on config/network failures.
 */
export async function getStreamingByImdbId(imdbId: string): Promise<StreamingInfo> {
  const find = await tmdbGet<FindResponse>(`/find/${imdbId}`, {
    external_source: 'imdb_id',
  });
  const tmdbId = find.movie_results?.[0]?.id;
  const now = new Date().toISOString();
  if (tmdbId == null) {
    return { region: STREAMING_REGION, link: null, stream: [], rent: [], buy: [], fetchedAt: now };
  }

  const data = await tmdbGet<WatchProvidersResponse>(`/movie/${tmdbId}/watch/providers`);
  const region = data.results?.[STREAMING_REGION];
  if (!region) {
    return { region: STREAMING_REGION, link: null, stream: [], rent: [], buy: [], fetchedAt: now };
  }

  // "stream" = subscription (flatrate) + free + ad-supported. These are the
  // "watch now without paying per-title" buckets the family cares about.
  const stream = mapProviders([
    ...(region.flatrate ?? []),
    ...(region.free ?? []),
    ...(region.ads ?? []),
  ]);
  return {
    region: STREAMING_REGION,
    link: region.link ?? null,
    stream,
    rent: mapProviders(region.rent),
    buy: mapProviders(region.buy),
    fetchedAt: now,
  };
}

/** True when streaming data is stale enough to refetch. */
export function isStreamingStale(info: StreamingInfo | null | undefined, maxAgeDays = 7): boolean {
  if (!info?.fetchedAt) return true;
  const fetched = Date.parse(info.fetchedAt);
  if (!Number.isFinite(fetched)) return true;
  return Date.now() - fetched > maxAgeDays * 24 * 60 * 60 * 1000;
}

/** Whether a resolved StreamingInfo has anything to show. */
export function hasStreamingProviders(info: StreamingInfo | null | undefined): boolean {
  return Boolean(info && (info.stream.length || info.rent.length || info.buy.length));
}
