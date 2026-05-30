import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared types and lookup logic for the share handlers
 * (/api/share and /api/share/[title]). The `_lib` prefix keeps this
 * file from being treated as a serverless function by Vercel.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// Prefer the server-only service-role key so this server-rendered unfurl
// path can still read movie data after the RLS lockdown (anonymous reads
// are now blocked). Falls back to the anon key when the service-role key
// isn't set yet — previews then degrade to the default OG image instead
// of crashing. The service-role key must NEVER carry the VITE_ prefix, or
// Vite would inline it into the client bundle.
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

export const env = {
  hasSupabaseUrl: Boolean(supabaseUrl),
  hasSupabaseKey: Boolean(supabaseKey),
};

/**
 * Same UUID as `JOHNSON_FAMILY_UUID` in src/supabase.ts. Duplicated as
 * a string literal because the API routes can't import from the bundled
 * Vite client tree (different tsconfig + Vercel function bundling).
 */
const JOHNSON_FAMILY_UUID = '00000001-0000-0000-0000-000000000001';
const DEFAULT_FAMILY_SLUG = 'johnson';

export type MovieLike = {
  title: string;
  displayTitle?: string | null;
  year?: number | null;
  rottenTomatoes?: string | null;
  imdb?: string | null;
  commonSenseAge?: string | null;
  poster?: string | null;
};

type LibraryEntryLike = {
  title: string;
  imdbId?: string | null;
  displayTitle?: string | null;
  commonSenseAge?: string | null;
};

type CandidateLike = {
  title: string;
  imdbId?: string | null;
  year?: number | null;
  poster?: string | null;
  rottenTomatoes?: string | null;
  imdb?: string | null;
  commonSenseAge?: string | null;
};

export type LookupResult = {
  movie: MovieLike | null;
  debug: {
    entryCount: number;
    candidateCount: number;
    entryMatch: 'exact' | 'ci' | 'none';
    candidateMatch: 'imdbId' | 'exact' | 'ci' | 'none';
    familyId?: string;
    supabaseError?: string;
  };
};

// Normalize for comparison: lowercase, NFC-normalize, trim, collapse
// internal whitespace. Catches casing drift, stray trailing spaces,
// and stylistic whitespace differences between an OMDB-canonical title
// and what's stored in the row.
export function normalizeTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Resolves a public slug to its `families.id`. Null/the default
 * Johnsons slug short-circuit to the bootstrap UUID so the existing
 * single-family hot path doesn't pay an extra round trip.
 */
export async function resolveFamilyId(
  supabase: SupabaseClient,
  slug: string | null,
): Promise<string | null> {
  if (!slug || slug === DEFAULT_FAMILY_SLUG) return JOHNSON_FAMILY_UUID;
  const { data, error } = await supabase
    .from('families')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

type MovieNightRow = {
  family_id: string | null;
  kind: string;
  movies: unknown;
};

// Per-family library row joined with the global pool row to produce a
// renderable Movie. Same precedence as `findCandidate` / `mergeEntry`
// in src/useMovies.ts. When the shared title isn't in the library
// (e.g. a For You candidate shared straight from the Detail preview),
// fall back to the Candidate alone so the unfurl still gets a poster.
export async function lookupMovie(
  slug: string | null,
  title: string,
): Promise<LookupResult> {
  const debug: LookupResult['debug'] = {
    entryCount: 0,
    candidateCount: 0,
    entryMatch: 'none',
    candidateMatch: 'none',
  };
  if (!title || !supabaseUrl || !supabaseKey) return { movie: null, debug };
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const familyId = await resolveFamilyId(supabase, slug);
    if (!familyId) {
      debug.supabaseError = `unknown family slug: ${slug}`;
      return { movie: null, debug };
    }
    debug.familyId = familyId;
    // Single round-trip: pull every library + pool row, filter to the
    // ones that match the family. Fan-out is O(families) — fine at
    // current scale; can switch to a per-family `.eq` join if it grows.
    const { data, error } = await supabase
      .from('movie_night')
      .select('family_id, kind, movies')
      .in('kind', ['library', 'pool']);
    if (error) {
      debug.supabaseError = error.message;
      return { movie: null, debug };
    }
    if (!data) return { movie: null, debug };
    const rows = data as MovieNightRow[];
    const libRow = rows.find(
      (r) => r.kind === 'library' && r.family_id === familyId,
    );
    const poolRow = rows.find((r) => r.kind === 'pool' && r.family_id == null);
    const entries = (Array.isArray(libRow?.movies)
      ? libRow.movies
      : []) as LibraryEntryLike[];
    const candidates = (Array.isArray(poolRow?.movies)
      ? poolRow.movies
      : []) as CandidateLike[];
    debug.entryCount = entries.length;
    debug.candidateCount = candidates.length;
    const titleNorm = normalizeTitle(title);
    let entry = entries.find((x) => x?.title === title);
    if (entry) debug.entryMatch = 'exact';
    else {
      entry = entries.find((x) => normalizeTitle(x?.title) === titleNorm);
      if (entry) debug.entryMatch = 'ci';
    }
    let candidate: CandidateLike | undefined;
    if (entry) {
      if (entry.imdbId) {
        candidate = candidates.find((c) => c.imdbId === entry!.imdbId);
        if (candidate) debug.candidateMatch = 'imdbId';
      }
      if (!candidate) {
        const entryNorm = normalizeTitle(entry.title);
        candidate = candidates.find(
          (c) => normalizeTitle(c.title) === entryNorm,
        );
        if (candidate) debug.candidateMatch = 'ci';
      }
    } else {
      candidate = candidates.find((c) => c.title === title);
      if (candidate) debug.candidateMatch = 'exact';
      else {
        candidate = candidates.find(
          (c) => normalizeTitle(c.title) === titleNorm,
        );
        if (candidate) debug.candidateMatch = 'ci';
      }
    }
    if (!entry && !candidate) return { movie: null, debug };
    return {
      movie: {
        title: entry?.title ?? candidate?.title ?? title,
        displayTitle: entry?.displayTitle ?? null,
        commonSenseAge:
          entry?.commonSenseAge ?? candidate?.commonSenseAge ?? null,
        year: candidate?.year ?? null,
        poster: candidate?.poster ?? null,
        rottenTomatoes: candidate?.rottenTomatoes ?? null,
        imdb: candidate?.imdb ?? null,
      },
      debug,
    };
  } catch (e) {
    debug.supabaseError = e instanceof Error ? e.message : String(e);
    return { movie: null, debug };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

/**
 * Build the modified index.html with dynamic og/twitter tags injected
 * and static fallbacks stripped. Optionally adds a meta-refresh so a
 * human tapping the share URL lands in the SPA.
 */
export function buildShareHtml(params: {
  template: string;
  origin: string;
  movie: MovieLike | null;
  canonical: string;
  posterPath: string;
  spaRedirect?: string;
}): string {
  const { template, origin, movie, canonical, posterPath, spaRedirect } =
    params;

  const titleTxt = movie
    ? `${movie.displayTitle?.trim() || movie.title}${
        movie.year ? ` (${movie.year})` : ''
      }`
    : 'Family Movie Night';
  const descParts: string[] = [];
  if (movie?.rottenTomatoes) descParts.push(`RT ${movie.rottenTomatoes}`);
  if (movie?.imdb) descParts.push(`IMDb ${movie.imdb}`);
  if (movie?.commonSenseAge) descParts.push(movie.commonSenseAge);
  const desc =
    descParts.length > 0
      ? descParts.join(' — ')
      : 'Our family movie night tracker';
  // og:image points at our same-origin .jpg-extensioned proxy. The
  // exact path is built by the caller because it differs between the
  // default share route (/api/poster/<title>.jpg) and the family-
  // prefixed route (/api/poster/f/<slug>/<title>.jpg). Originally we
  // tried the raw Amazon URL, but those poster paths contain "@"
  // (Amazon's content-hash delimiter) which Apple's
  // LPMetadataProvider appears to reject when validating the URL —
  // Safari renders it fine, but the unfurl card silently drops the
  // image. Routing through our domain gives Apple a clean URL to
  // fetch and we handle the Amazon side server-side where lenient
  // URL parsing is the norm.
  //
  // The ?v=<commit> cache-buster ensures Apple's per-URL "this image
  // is broken" cache (built up during many failed deploys) doesn't
  // poison fresh attempts. Each new deploy emits a different
  // og:image URL, sidestepping any prior negative cache entry.
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  const img = movie?.poster
    ? `${origin}${posterPath}?v=${commit}`
    : `${origin}/og-image.svg`;

  // Strip the static og:*, twitter:*, and apple-touch-icon link tags
  // from the template so the injected ones are the only copy the
  // unfurler sees. Apple's LPMetadataProvider picks the *first*
  // og:image, and falls back to apple-touch-icon when og:image can't
  // be fetched, so leaving either in place risked the static
  // play-button icon winning.
  const stripped = template
    .replace(/\s*<meta\s+property="og:[^"]+"[^>]*\/?\s*>/gi, '')
    .replace(/\s*<meta\s+name="twitter:[^"]+"[^>]*\/?\s*>/gi, '')
    .replace(/\s*<link\s+rel="apple-touch-icon"[^>]*\/?\s*>/gi, '');

  // Apple's LPMetadataProvider rejects og:image below ~600x315 and
  // silently falls back to apple-touch-icon / Safari placeholder.
  // Declaring dimensions matching what /api/poster returns (600px
  // wide, ~888px tall after the SX300→SX600 upscale, 2:3 poster
  // aspect ratio) tells the unfurler the image is large enough.
  const tagLines: string[] = [
    `<meta property="og:type" content="video.movie" />`,
    `<meta property="og:title" content="${escapeHtml(titleTxt)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:image" content="${escapeHtml(img)}" />`,
    ...(movie?.poster
      ? [
          `<meta property="og:image:width" content="600" />`,
          `<meta property="og:image:height" content="888" />`,
          `<meta property="og:image:type" content="image/jpeg" />`,
        ]
      : []),
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(titleTxt)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(img)}" />`,
  ];
  if (spaRedirect) {
    // Unfurlers (iMessage, Slack, etc.) read meta tags but don't
    // follow meta-refresh — they see the og:* tags and render a
    // preview. Browsers follow the refresh and land in the SPA.
    tagLines.unshift(
      `<meta http-equiv="refresh" content="0; url=${escapeHtml(spaRedirect)}" />`,
    );
  }

  const tags = tagLines.join('\n    ');
  return stripped.replace('</head>', `    ${tags}\n  </head>`);
}
