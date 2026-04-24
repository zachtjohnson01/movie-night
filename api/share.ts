import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

/**
 * Dynamic OG-tag injector for share links like `/?m=<title>`.
 * vercel.json rewrites `/?m=...` to this function so unfurlers
 * (iMessage, Slack, Twitter, etc.) fetching the shared URL see a
 * page with movie-specific `og:title` / `og:description` /
 * `og:image`, producing a rich preview card. The browser SPA's
 * own client-side routing picks up `?m=` separately in App.tsx.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const m = typeof req.query.m === 'string' ? req.query.m : '';
  const host = req.headers.host ?? '';
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
  const origin = `${proto}://${host}`;

  // Fetch the deployed index.html as a template. vercel.json only
  // rewrites `/` when `?m=` is present, so hitting `/index.html`
  // directly bypasses the rewrite and returns the static file.
  const templateRes = await fetch(`${origin}/index.html`);
  if (!templateRes.ok) {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    return res.status(502).send('failed to fetch index.html template');
  }
  const html = await templateRes.text();

  // `?debug=1` returns a JSON dump of the lookup state so we can diagnose
  // "why did the unfurl fall back to the generic icon?" from a browser
  // without inspecting the rendered meta tags. Safe to leave in — no
  // secrets are exposed beyond the already-client-visible Supabase key.
  const debug = req.query.debug === '1';

  const lookup = await lookupMovie(m);

  if (debug) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({
      requestedTitle: m,
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseKey: Boolean(supabaseKey),
      ...lookup.debug,
      resolved: lookup.movie,
    });
  }

  const movie = lookup.movie;

  const titleTxt = movie
    ? `${(movie.displayTitle?.trim() || movie.title) as string}${
        movie.year ? ` (${movie.year})` : ''
      }`
    : 'Family Movie Night';
  const descParts: string[] = [];
  if (movie?.rottenTomatoes) descParts.push(`RT ${movie.rottenTomatoes}`);
  if (movie?.imdb) descParts.push(`IMDb ${movie.imdb}`);
  if (movie?.commonSenseAge) descParts.push(movie.commonSenseAge as string);
  const desc =
    descParts.length > 0
      ? descParts.join(' — ')
      : 'Our family movie night tracker';
  const img =
    (movie?.poster as string | undefined) || `${origin}/apple-touch-icon.png`;
  const canonical = `${origin}/?m=${encodeURIComponent(m)}`;

  // Strip the static og:* and twitter:* meta tags from the template so
  // the injected ones are the only copy the unfurler sees. Apple's
  // LPMetadataProvider picks the *first* og:image, so leaving the
  // static "/apple-touch-icon.png" tag above ours silently drops the
  // movie poster every time.
  const stripped = html
    .replace(/\s*<meta\s+property="og:[^"]+"[^>]*\/?\s*>/gi, '')
    .replace(/\s*<meta\s+name="twitter:[^"]+"[^>]*\/?\s*>/gi, '');

  const tags = [
    `<meta property="og:type" content="video.movie" />`,
    `<meta property="og:title" content="${escapeHtml(titleTxt)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:image" content="${escapeHtml(img)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(titleTxt)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(img)}" />`,
  ].join('\n    ');

  const out = stripped.replace('</head>', `    ${tags}\n  </head>`);

  res.setHeader('content-type', 'text/html; charset=utf-8');
  // Hits cache for 60s; misses do not cache so a deploy/fix propagates
  // without a 24h SWR tail of stale generic previews on earlier misses.
  res.setHeader(
    'cache-control',
    movie
      ? 'public, s-maxage=60, stale-while-revalidate=300'
      : 'public, no-cache, no-store, must-revalidate',
  );
  res.setHeader('x-share-resolved', movie ? '1' : '0');
  return res.status(200).send(out);
}

type MovieLike = {
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

type LookupResult = {
  movie: MovieLike | null;
  debug: {
    entryCount: number;
    candidateCount: number;
    entryMatch: 'exact' | 'ci' | 'none';
    candidateMatch: 'imdbId' | 'exact' | 'ci' | 'none';
    supabaseError?: string;
  };
};

// Normalize for comparison: lowercase, NFC-normalize, trim, collapse
// internal whitespace. Catches casing drift, stray trailing spaces, and
// stylistic whitespace differences between an OMDB-canonical title and
// what's stored in the row.
function normalizeTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Row id=1 holds LibraryEntry[] (user overlay), row id=2 holds Candidate[]
// (OMDB enrichment). The rendered movie is the join of the two — same
// precedence as `findCandidate` / `mergeEntry` in src/useMovies.ts.
// When the shared title isn't in the library (e.g. a For You candidate
// shared straight from the Detail preview), fall back to the Candidate
// alone so the unfurl still gets a poster.
async function lookupMovie(title: string): Promise<LookupResult> {
  const debug: LookupResult['debug'] = {
    entryCount: 0,
    candidateCount: 0,
    entryMatch: 'none',
    candidateMatch: 'none',
  };
  if (!title || !supabaseUrl || !supabaseKey) return { movie: null, debug };
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('movie_night')
      .select('id, movies')
      .in('id', [1, 2]);
    if (error) {
      debug.supabaseError = error.message;
      return { movie: null, debug };
    }
    if (!data) return { movie: null, debug };
    const entries =
      (data.find((r) => r.id === 1)?.movies ?? []) as LibraryEntryLike[];
    const candidates =
      (data.find((r) => r.id === 2)?.movies ?? []) as CandidateLike[];
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
        candidate = candidates.find((c) => normalizeTitle(c.title) === entryNorm);
        if (candidate) debug.candidateMatch = 'ci';
      }
    } else {
      candidate = candidates.find((c) => c.title === title);
      if (candidate) debug.candidateMatch = 'exact';
      else {
        candidate = candidates.find((c) => normalizeTitle(c.title) === titleNorm);
        if (candidate) debug.candidateMatch = 'ci';
      }
    }
    if (!entry && !candidate) return { movie: null, debug };
    return {
      movie: {
        title: entry?.title ?? candidate?.title ?? title,
        displayTitle: entry?.displayTitle ?? null,
        commonSenseAge: entry?.commonSenseAge ?? candidate?.commonSenseAge ?? null,
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

function escapeHtml(s: string): string {
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
