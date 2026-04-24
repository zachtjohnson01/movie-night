import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Same-origin passthrough for OMDB poster images. iMessage's link
 * previewer (LPMetadataProvider) sometimes fails to fetch directly
 * from m.media-amazon.com — depending on the request's user agent
 * Amazon may 403 or stall, and the unfurl then falls back to the
 * apple-touch-icon. Routing `og:image` through this proxy means the
 * fetch is against familymovienight.watch, which we control and can
 * respond to reliably.
 *
 * Allowlist keeps this from being turned into an open proxy. Add
 * hostnames only when they match poster URLs OMDB actually returns.
 */
const ALLOWED_HOSTS = new Set([
  'm.media-amazon.com',
  'ia.media-amazon.com',
  'image.tmdb.org',
]);

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!url) {
    res.setHeader('access-control-allow-origin', '*');
    return res.status(400).send('missing url');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.setHeader('access-control-allow-origin', '*');
    return res.status(400).send('invalid url');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    res.setHeader('access-control-allow-origin', '*');
    return res.status(403).send('host not allowed');
  }
  try {
    const upstream = await fetch(parsed.toString(), {
      // Amazon's poster CDN seems to behave better with a normal
      // browser-ish User-Agent than the default undici one.
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
    // Cache aggressively — poster URLs are immutable, identified by
    // Amazon's content hash in the path.
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
