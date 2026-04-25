import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * OG-tag injector for share links like `/share/<title>`. Default route
 * scoped to the bootstrap Johnsons family — preserves existing iMessage
 * unfurls without changing their URL shape.
 *
 * The lookup + HTML-build logic is intentionally inlined (not imported
 * from ../_lib/share-core) because Vercel's function bundler drops the
 * helper module from this route's deploy. Sibling /api/poster/[slug].ts
 * was already inlined for the same reason — when api/share.ts also
 * existed, its tracer pass apparently pulled _lib into the bundle and
 * masked the issue here. Once api/share.ts was deleted to fix the
 * filesystem-router collision, this route started crashing at module
 * load with FUNCTION_INVOCATION_FAILED before the handler's try/catch
 * could ever run. The canonical copy of these helpers lives in
 * api/_lib/share-core.ts and is unit-tested there; this file's behavior
 * is verified end-to-end through api/share/[title].test.ts.
 *
 * Returned HTML includes:
 *   - Dynamic og:* / twitter:* tags so unfurlers (iMessage, Slack,
 *     Twitter, etc.) render a rich preview with the movie poster.
 *   - A <meta http-equiv="refresh"> redirect to `/?m=<title>` so when
 *     a human taps the link, their browser lands in the SPA with the
 *     existing client-side deep-link reader handling the rest.
 *     Unfurlers read meta tags but don't follow meta-refresh, so they
 *     see the preview tags before the redirect.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

// Same UUID as src/supabase.ts. Inlined because API routes can't pull
// from the Vite client tree without dragging the bundler quirk back in.
const JOHNSON_FAMILY_UUID = '00000001-0000-0000-0000-000000000001';

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

type MovieLike = {
  title: string;
  displayTitle?: string | null;
  year?: number | null;
  rottenTomatoes?: string | null;
  imdb?: string | null;
  commonSenseAge?: string | null;
  poster?: string | null;
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

type MovieNightRow = {
  family_id: string | null;
  kind: string;
  movies: unknown;
};

function normalizeTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
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
      .select('family_id, kind, movies')
      .in('kind', ['library', 'pool']);
    if (error) {
      debug.supabaseError = error.message;
      return { movie: null, debug };
    }
    if (!data) return { movie: null, debug };
    const rows = data as MovieNightRow[];
    const libRow = rows.find(
      (r) => r.kind === 'library' && r.family_id === JOHNSON_FAMILY_UUID,
    );
    const poolRow = rows.find(
      (r) => r.kind === 'pool' && r.family_id == null,
    );
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

function buildShareHtml(params: {
  template: string;
  origin: string;
  movie: MovieLike | null;
  canonical: string;
  spaRedirect?: string;
}): string {
  const { template, origin, movie, canonical, spaRedirect } = params;

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
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  const img = movie?.poster
    ? `${origin}/api/poster/${encodeURIComponent(movie.title)}.jpg?v=${commit}`
    : `${origin}/og-image.svg`;

  const stripped = template
    .replace(/\s*<meta\s+property="og:[^"]+"[^>]*\/?\s*>/gi, '')
    .replace(/\s*<meta\s+name="twitter:[^"]+"[^>]*\/?\s*>/gi, '')
    .replace(/\s*<link\s+rel="apple-touch-icon"[^>]*\/?\s*>/gi, '');

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
    tagLines.unshift(
      `<meta http-equiv="refresh" content="0; url=${escapeHtml(spaRedirect)}" />`,
    );
  }

  const tags = tagLines.join('\n    ');
  return stripped.replace('</head>', `    ${tags}\n  </head>`);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  res.setHeader('x-commit', commit);

  try {
    const rawTitle = req.query.title;
    const title =
      typeof rawTitle === 'string'
        ? decodeURIComponent(rawTitle)
        : Array.isArray(rawTitle)
          ? decodeURIComponent(rawTitle[0] ?? '')
          : '';
    const host = req.headers.host ?? '';
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
    const origin = `${proto}://${host}`;

    const templateRes = await fetch(`${origin}/index.html`);
    if (!templateRes.ok) {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res
        .status(502)
        .send(`failed to fetch index.html template (commit ${commit})`);
    }
    const template = await templateRes.text();

    const debug = req.query.debug === '1';
    const debugHtml = req.query.debug === 'html';

    const lookup = await lookupMovie(title);

    if (debug) {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.status(200).json({
        commit,
        requestedTitle: title,
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseKey: Boolean(supabaseKey),
        ...lookup.debug,
        resolved: lookup.movie,
      });
    }

    const canonical = `${origin}/share/${encodeURIComponent(title)}`;
    const spaRedirect = `/?m=${encodeURIComponent(title)}`;

    const out = buildShareHtml({
      template,
      origin,
      movie: lookup.movie,
      canonical,
      spaRedirect,
    });

    if (debugHtml) {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.status(200).send(out);
    }

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader(
      'cache-control',
      'public, no-cache, no-store, must-revalidate',
    );
    res.setHeader('x-share-resolved', lookup.movie ? '1' : '0');
    return res.status(200).send(out);
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res
      .status(500)
      .send(`share handler crashed (commit ${commit}): ${msg}`);
  }
}
