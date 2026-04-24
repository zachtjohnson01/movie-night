import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  buildShareHtml,
  env,
  lookupMovie,
} from '../_lib/share-core';

/**
 * OG-tag injector for share links like `/share/<title>`.
 *
 * This replaces the fragile `/?m=<title>` + root-path rewrite
 * approach. Vercel routes `/share/*` here via a path-prefix rewrite
 * in vercel.json, which is far more reliable than matching the root
 * path with a `has`-query-param condition.
 *
 * The returned HTML includes:
 *   - Dynamic og:* / twitter:* tags so unfurlers (iMessage, Slack,
 *     Twitter, etc.) render a rich preview with the movie poster.
 *   - A <meta http-equiv="refresh"> redirect to `/?m=<title>` so when
 *     a human taps the link, their browser lands in the SPA with the
 *     existing client-side deep-link reader handling the rest.
 *     Unfurlers read meta tags but don't follow meta-refresh, so they
 *     see the preview tags before the redirect.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
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
    return res.status(502).send('failed to fetch index.html template');
  }
  const template = await templateRes.text();

  const debug = req.query.debug === '1';
  const debugHtml = req.query.debug === 'html';

  const lookup = await lookupMovie(title);

  if (debug) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({
      requestedTitle: title,
      ...env,
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
  res.setHeader('cache-control', 'public, no-cache, no-store, must-revalidate');
  res.setHeader('x-share-resolved', lookup.movie ? '1' : '0');
  return res.status(200).send(out);
}
