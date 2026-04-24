import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lookupMovie } from '../_lib/share-core';

/**
 * Poster image proxy on a clean .jpg-extensioned URL. Used as the
 * og:image target so Apple's LPMetadataProvider sees a URL it can
 * unambiguously parse and validate as an image.
 *
 * Static import of share-core is intentional: Vercel's Node bundler
 * traces static imports to decide what to include in the function
 * deploy. A dynamic `await import(...)` here in a previous revision
 * silently dropped `_lib/share-core` from the bundle and the
 * function crashed at runtime with ERR_MODULE_NOT_FOUND.
 */
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
      const lookup = title ? await lookupMovie(title) : null;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.status(200).json({
        commit,
        rawSlug,
        slug,
        title,
        lookup: lookup?.debug ?? null,
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
        .send(
          `poster not found for "${title}" (match=${lookup.debug.entryMatch})`,
        );
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
    return res
      .status(500)
      .send(
        `poster handler crashed (commit ${commit}): ${msg}${stack ? '\n\n' + stack : ''}`,
      );
  }
}
