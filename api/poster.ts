import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Thin CORS-safe passthrough for OMDB poster images. The Share button
 * fetches `/api/poster?url=<poster>` so it can wrap the bytes in a
 * `File` and pass them to `navigator.share({ files: [...] })`. Direct
 * cross-origin fetch from the browser to m.media-amazon.com fails
 * because Amazon's image CDN doesn't return `Access-Control-Allow-Origin`.
 *
 * The allowlist keeps us from turning this into an open proxy. Add
 * hostnames here only when we can point at an example poster URL
 * OMDB actually returned for a linked movie.
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
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      res.setHeader('access-control-allow-origin', '*');
      return res.status(upstream.status).send('upstream error');
    }
    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=86400, s-maxage=86400');
    res.setHeader('access-control-allow-origin', '*');
    return res.status(200).send(buf);
  } catch (e) {
    res.setHeader('access-control-allow-origin', '*');
    return res
      .status(502)
      .send(`proxy fetch failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}
