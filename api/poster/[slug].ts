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
  const rawSlug = req.query.slug;
  const slug =
    typeof rawSlug === 'string'
      ? rawSlug
      : Array.isArray(rawSlug)
        ? (rawSlug[0] ?? '')
        : '';
  // Strip the .jpg / .jpeg / .png extension if present.
  const title = slug.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  if (!title) {
    res.setHeader('access-control-allow-origin', '*');
    return res.status(400).send('missing title');
  }

  const lookup = await lookupMovie(title);
  const posterUrl = lookup.movie?.poster;
  if (!posterUrl) {
    res.setHeader('access-control-allow-origin', '*');
    return res.status(404).send('poster not found');
  }

  try {
    const upstream = await fetch(posterUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!upstream.ok) {
      res.setHeader('access-control-allow-origin', '*');
      return res.status(upstream.status).send('upstream error');
    }
    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-type', contentType);
    // Posters are immutable for a given title once OMDB is resolved.
    // 7-day cache at the edge plus the same on the client.
    res.setHeader('cache-control', 'public, max-age=604800, s-maxage=604800');
    res.setHeader('access-control-allow-origin', '*');
    return res.status(200).send(buf);
  } catch (e) {
    res.setHeader('access-control-allow-origin', '*');
    return res
      .status(502)
      .send(`proxy fetch failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}
