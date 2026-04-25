import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * Poster image proxy on a clean .jpg-extensioned URL. Used as the
 * og:image target so Apple's LPMetadataProvider sees a URL it can
 * unambiguously parse and validate as an image.
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

type LibraryEntryLike = {
  title: string;
  imdbId?: string | null;
};

type CandidateLike = {
  title: string;
  imdbId?: string | null;
  poster?: string | null;
};

function normalizeTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

async function lookupPosterUrl(
  title: string,
): Promise<{ poster: string | null; entryMatch: string }> {
  if (!title || !supabaseUrl || !supabaseKey) {
    return { poster: null, entryMatch: 'no-env' };
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from('movie_night')
    .select('id, movies')
    .in('id', [1, 2]);
  if (error || !data) {
    return { poster: null, entryMatch: error ? 'supabase-error' : 'no-data' };
  }
  const entries =
    (data.find((r) => r.id === 1)?.movies ?? []) as LibraryEntryLike[];
  const candidates =
    (data.find((r) => r.id === 2)?.movies ?? []) as CandidateLike[];
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

    // Apple's LPMetadataProvider needs at least 600px-wide images to
    // render a rich preview card (300px gets rejected and falls back
    // to apple-touch-icon / Safari placeholder). OMDB returns
    // posters at `_SX300`; upscale to `_SX600` via Amazon's CDN
    // size operator. Same image, larger render.
    const posterUrl = posterRawUrl.replace(/_SX\d+/, '_SX600');

    const upstream = await fetch(posterUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!upstream.ok) {
      res.setHeader('access-control-allow-origin', '*');
      return res
        .status(upstream.status)
        .send(`upstream ${upstream.status}: ${posterUrl}`);
    }
    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=604800, s-maxage=604800');
    res.setHeader('access-control-allow-origin', '*');
    return res.status(200).send(buf);
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'no-store');
    return res
      .status(500)
      .send(
        `poster handler crashed (commit ${commit}): ${msg}${stack ? '\n\n' + stack : ''}`,
      );
  }
}
