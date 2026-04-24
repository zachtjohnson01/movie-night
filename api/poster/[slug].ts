import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lookupMovie } from '../_lib/share-core';

/**
 * Poster image proxy on a clean .jpg-extensioned URL. Used as the
 * og:image target so Apple's LPMetadataProvider sees a URL it can
 * unambiguously parse and validate as an image.
 *
 * Why this exists: Amazon's OMDB poster URLs include an "@" character
 * in the path (Amazon's content hash). Browsers parse it leniently,
 * but Apple's link-preview image loader appears to choke on it,
 * silently dropping the image. Routing through `/api/poster/<title>.jpg`
 * gives Apple a URL with no special characters and a recognizable
 * extension; we fetch from Amazon server-side where strict parsing
 * isn't an issue.
 *
 * The path segment is the URL-encoded movie title with `.jpg` suffix.
 * We strip the suffix, look up the movie, then proxy the poster bytes.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  // Wrap the entire handler in try/catch so unhandled errors surface
  // as a readable text response instead of Vercel's opaque
  // FUNCTION_INVOCATION_FAILED page. Debug hits can then get the
  // actual stack trace with ?debug=1.
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
      const lookup = title ? await lookupMovie(title) : null;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.status(200).json({
        rawSlug,
        slug,
        title,
        lookup: lookup?.debug,
        poster: lookup?.movie?.poster ?? null,
      });
    }

    if (!title) {
      res.setHeader('access-control-allow-origin', '*');
      return res.status(400).send('missing title');
    }

    const lookup = await lookupMovie(title);
    const posterUrl = lookup.movie?.poster;
    if (!posterUrl) {
      res.setHeader('access-control-allow-origin', '*');
      return res
        .status(404)
        .send(`poster not found for "${title}" (match=${lookup.debug.entryMatch})`);
    }

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
    return res.status(500).send(`poster handler crashed: ${msg}${stack ? '\n\n' + stack : ''}`);
  }
}
