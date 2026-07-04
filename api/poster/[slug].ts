import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * Poster image proxy on a clean .jpg-extensioned URL. Default route
 * scoped to the bootstrap Johnsons family — preserves the existing
 * iMessage og:image URL shape.
 *
 * The lookup logic is intentionally inlined (rather than imported
 * from ../_lib/share-core) because Vercel's function bundler dropped
 * the helper module from this route's deploy when imported via the
 * underscore-prefixed folder, even with a static top-of-file import.
 * Sibling /api/share/[title].ts using the same import works; this
 * route consistently crashed with ERR_MODULE_NOT_FOUND. Inlining
 * removes the bundler quirk entirely.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const JOHNSON_FAMILY_UUID = '00000001-0000-0000-0000-000000000001';

type LibraryEntryLike = {
  title: string;
  imdbId?: string | null;
};

type CandidateLike = {
  title: string;
  imdbId?: string | null;
  poster?: string | null;
};

type MovieNightRow = {
  family_id: string | null;
  kind: string;
  movies: unknown;
};

export function normalizeTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Apple's LPMetadataProvider needs at least 600px-wide images to render a
// rich preview card (300px gets rejected). OMDB returns posters at `_SX300`;
// upscale to `_SX600` via Amazon's CDN size operator. Same image, larger render.
// Already-`_SX600`-or-larger URLs stay; non-matching URLs pass through unchanged.
export function rewritePosterSize(url: string): string {
  return url.replace(/_SX\d+/, '_SX600');
}

// SSRF guard: OMDB posters live on Amazon's image CDN, and the stored `poster`
// field is DB-supplied. Restrict what this open, unauthenticated proxy will
// fetch to that one host over https; anything else is treated as "no poster".
const ALLOWED_POSTER_HOSTS = new Set(['m.media-amazon.com']);
const POSTER_FETCH_TIMEOUT_MS = 6000;

export function isAllowedPosterUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' && ALLOWED_POSTER_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export async function lookupPosterUrl(
  title: string,
): Promise<{ poster: string | null; entryMatch: string }> {
  if (!title || !supabaseUrl || !supabaseKey) {
    return { poster: null, entryMatch: 'no-env' };
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from('movie_night')
    .select('family_id, kind, movies')
    .in('kind', ['library', 'pool']);
  if (error || !data) {
    return { poster: null, entryMatch: error ? 'supabase-error' : 'no-data' };
  }
  const rows = data as MovieNightRow[];
  const libRow = rows.find(
    (r) => r.kind === 'library' && r.family_id === JOHNSON_FAMILY_UUID,
  );
  const poolRow = rows.find((r) => r.kind === 'pool' && r.family_id == null);
  const entries = (Array.isArray(libRow?.movies)
    ? libRow.movies
    : []) as LibraryEntryLike[];
  const candidates = (Array.isArray(poolRow?.movies)
    ? poolRow.movies
    : []) as CandidateLike[];
  const titleNorm = normalizeTitle(title);

  let entry = entries.find((x) => x?.title === title);
  let entryMatch = entry ? 'exact' : 'none';
  if (!entry) {
    entry = entries.find((x) => normalizeTitle(x?.title) === titleNorm);
    if (entry) entryMatch = 'ci';
  }

  let candidate: CandidateLike | undefined;
  if (entry) {
    if (entry.imdbId) {
      candidate = candidates.find((c) => c.imdbId === entry!.imdbId);
    }
    if (!candidate) {
      const entryNorm = normalizeTitle(entry.title);
      candidate = candidates.find(
        (c) => normalizeTitle(c.title) === entryNorm,
      );
    }
  } else {
    candidate = candidates.find((c) => c.title === title);
    if (!candidate) {
      candidate = candidates.find(
        (c) => normalizeTitle(c.title) === titleNorm,
      );
    }
  }
  return { poster: candidate?.poster ?? null, entryMatch };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  res.setHeader('x-commit', commit);

  const debug = req.query.debug === '1';
  try {
    const rawSlug = req.query.slug;
    const slug =
      typeof rawSlug === 'string'
        ? rawSlug
        : Array.isArray(rawSlug)
          ? (rawSlug[0] ?? '')
          : '';
    const title = slug.replace(/\.(jpg|jpeg|png|webp)$/i, '');

    if (debug) {
      const lookup = title
        ? await lookupPosterUrl(title)
        : { poster: null, entryMatch: 'no-title' };
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.status(200).json({
        commit,
        rawSlug,
        slug,
        title,
        ...lookup,
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseKey: Boolean(supabaseKey),
      });
    }

    if (!title) {
      res.setHeader('access-control-allow-origin', '*');
      return res.status(400).send('missing title');
    }

    const { poster: posterRawUrl, entryMatch } = await lookupPosterUrl(title);
    if (!posterRawUrl) {
      res.setHeader('access-control-allow-origin', '*');
      return res
        .status(404)
        .send(`poster not found for "${title}" (match=${entryMatch})`);
    }

    const posterUrl = rewritePosterSize(posterRawUrl);
    if (!isAllowedPosterUrl(posterUrl)) {
      res.setHeader('access-control-allow-origin', '*');
      return res.status(404).send('poster unavailable');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POSTER_FETCH_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(posterUrl, {
        signal: controller.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });
    } catch {
      // Network failure or the timeout above aborted the request.
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('cache-control', 'no-store');
      return res.status(502).send('poster upstream unavailable');
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      res.setHeader('access-control-allow-origin', '*');
      return res.status(upstream.status).send(`upstream ${upstream.status}`);
    }
    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=604800, s-maxage=604800');
    res.setHeader('access-control-allow-origin', '*');
    return res.status(200).send(buf);
  } catch (e) {
    // Log the detail server-side; never leak the message/stack in the response.
    console.error('[poster] handler error', e);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'no-store');
    return res.status(500).send(`poster handler error (commit ${commit})`);
  }
}
