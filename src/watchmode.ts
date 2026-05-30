import type { StreamingInfo, StreamingProvider } from './types';

// Watchmode streaming-availability client. Replaces the earlier TMDB/JustWatch
// lookup (src/tmdb.ts, removed) because Watchmode returns real per-title deep
// links — its `web_url` points at the movie's own page inside each service,
// which universal-links straight into the app on mobile (or opens the website
// on desktop). No middle hop through a JustWatch aggregator page.
//
// Free tier is 2,500 requests/month; with the "cache onto the Candidate,
// refresh weekly" model this is plenty (a full backfill of the library is ~40
// requests). OMDB still has no streaming data — this is the dedicated source.

const WATCHMODE_BASE = 'https://api.watchmode.com/v1';
const WATCHMODE_KEY = import.meta.env.VITE_WATCHMODE_API_KEY;

const SOURCE = 'watchmode';
export const STREAMING_REGION = 'US';

export const isStreamingConfigured = Boolean(WATCHMODE_KEY);

export class StreamingError extends Error {
  constructor(
    message: string,
    public readonly kind: 'not-configured' | 'not-found' | 'network' | 'unknown',
  ) {
    super(message);
    this.name = 'StreamingError';
  }
}

async function wmGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!WATCHMODE_KEY) {
    throw new StreamingError(
      'Watchmode API key not configured. Add VITE_WATCHMODE_API_KEY in Vercel.',
      'not-configured',
    );
  }
  const qs = new URLSearchParams({ apiKey: WATCHMODE_KEY, ...params });
  let resp: Response;
  try {
    resp = await fetch(`${WATCHMODE_BASE}${path}?${qs.toString()}`);
  } catch (e) {
    throw new StreamingError(
      `Network error reaching Watchmode: ${(e as Error).message}`,
      'network',
    );
  }
  if (!resp.ok) {
    throw new StreamingError(
      `Watchmode returned HTTP ${resp.status}`,
      resp.status === 401 ? 'not-configured' : 'network',
    );
  }
  return (await resp.json()) as T;
}

// --- Source catalog (for logos) ---

// The per-title sources endpoint doesn't include logos, so we fetch the source
// catalog once per session and map source_id -> logo. Memoized via a module
// promise so a bulk refresh of N titles only costs one extra request total.
type WmCatalogSource = { id: number; name: string; logo_100px?: string | null };
let catalogPromise: Promise<Map<number, string | null>> | null = null;

function loadCatalog(): Promise<Map<number, string | null>> {
  if (!catalogPromise) {
    catalogPromise = wmGet<WmCatalogSource[]>('/sources/', { regions: STREAMING_REGION })
      .then((list) => {
        const map = new Map<number, string | null>();
        for (const s of list) map.set(s.id, s.logo_100px ?? null);
        return map;
      })
      .catch(() => {
        // Logos are cosmetic; a catalog failure shouldn't sink the whole
        // lookup. Reset so a later call can retry, and degrade to no logos.
        catalogPromise = null;
        return new Map<number, string | null>();
      });
  }
  return catalogPromise;
}

// --- Per-title sources ---

type WmSource = {
  source_id: number;
  name: string;
  type: string; // 'sub' | 'free' | 'tve' | 'rent' | 'purchase'
  region: string;
  web_url?: string | null;
  ios_url?: string | null;
};

// Title details response; we only consume the `sources` array appended via
// append_to_response=sources. The details endpoint (unlike /sources/) accepts
// a raw IMDb ID as the title id.
type WmDetails = {
  sources?: WmSource[];
};

function makeProvider(
  s: WmSource,
  logos: Map<number, string | null>,
): StreamingProvider {
  return {
    id: s.source_id,
    name: s.name,
    logo: logos.get(s.source_id) ?? null,
    link: s.web_url || s.ios_url || null,
  };
}

// Dedupe a bucket by source id, keeping the first (Watchmode lists a service
// once per format/quality; we only want one tile per service).
function dedupe(providers: StreamingProvider[]): StreamingProvider[] {
  const seen = new Set<number>();
  const out: StreamingProvider[] = [];
  for (const p of providers) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Resolve where a movie can be watched in {@link STREAMING_REGION} via Watchmode.
 *
 * Looked up via the title *details* endpoint with `append_to_response=sources`.
 * That endpoint accepts a raw IMDb ID (e.g. `tt0086190`) directly, whereas the
 * standalone `/sources/` endpoint only takes a numeric Watchmode ID — so this
 * avoids a per-title ID-conversion round trip (and the silent 404s that came
 * from passing an IMDb ID to `/sources/`).
 *
 * Always returns a {@link StreamingInfo} (empty arrays when nothing's available,
 * so "checked, found nothing" caches and doesn't refetch). Throws
 * {@link StreamingError} only on config/network failures.
 */
export async function getStreamingByImdbId(imdbId: string): Promise<StreamingInfo> {
  const [logos, details] = await Promise.all([
    loadCatalog(),
    wmGet<WmDetails>(`/title/${imdbId}/details/`, {
      append_to_response: 'sources',
    }),
  ]);
  const now = new Date().toISOString();
  const us = (details.sources ?? []).filter((s) => s.region === STREAMING_REGION);

  const stream = dedupe(
    us
      .filter((s) => s.type === 'sub' || s.type === 'free' || s.type === 'tve')
      .map((s) => makeProvider(s, logos)),
  );
  const rent = dedupe(
    us.filter((s) => s.type === 'rent').map((s) => makeProvider(s, logos)),
  );
  const buy = dedupe(
    us.filter((s) => s.type === 'purchase').map((s) => makeProvider(s, logos)),
  );

  return {
    region: STREAMING_REGION,
    link: null,
    stream,
    rent,
    buy,
    fetchedAt: now,
    source: SOURCE,
  };
}

/**
 * True when streaming data should be refetched: never fetched, older than
 * `maxAgeDays`, or produced by a different (older TMDB) source — the source
 * check forces a one-time refresh of caches written before the Watchmode switch.
 */
export function isStreamingStale(info: StreamingInfo | null | undefined, maxAgeDays = 7): boolean {
  if (!info?.fetchedAt) return true;
  if (info.source !== SOURCE) return true;
  const fetched = Date.parse(info.fetchedAt);
  if (!Number.isFinite(fetched)) return true;
  return Date.now() - fetched > maxAgeDays * 24 * 60 * 60 * 1000;
}

/** Whether a resolved StreamingInfo has anything to show. */
export function hasStreamingProviders(info: StreamingInfo | null | undefined): boolean {
  return Boolean(info && (info.stream.length || info.rent.length || info.buy.length));
}

// --- In-app search fallback ---

// Used only when a provider has no per-title deep link. These web URLs
// universal-link into the service's app on iOS (or open the site on desktop)
// and land on a search for the title — a list, not the exact movie, so it's a
// last resort behind Watchmode's real deep links. Matched by normalized name.
const SEARCH_TEMPLATES: Array<{ match: RegExp; url: (q: string) => string }> = [
  { match: /netflix/, url: (q) => `https://www.netflix.com/search?q=${q}` },
  { match: /disney/, url: (q) => `https://www.disneyplus.com/search?q=${q}` },
  { match: /hulu/, url: (q) => `https://www.hulu.com/search?q=${q}` },
  { match: /max|hbo/, url: (q) => `https://play.max.com/search?q=${q}` },
  { match: /prime|amazon/, url: (q) => `https://www.amazon.com/s?k=${q}&i=instant-video` },
  { match: /apple/, url: (q) => `https://tv.apple.com/search?term=${q}` },
  { match: /paramount/, url: (q) => `https://www.paramountplus.com/search/?query=${q}` },
  { match: /peacock/, url: (q) => `https://www.peacocktv.com/search?q=${q}` },
];

/** Best-effort in-app search link for a service, or null if we don't map it. */
export function appSearchUrl(serviceName: string, title: string): string | null {
  const name = serviceName.toLowerCase();
  const q = encodeURIComponent(title.trim());
  const hit = SEARCH_TEMPLATES.find((t) => t.match.test(name));
  return hit ? hit.url(q) : null;
}
