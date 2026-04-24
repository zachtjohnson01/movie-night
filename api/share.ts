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

  const movie = await lookupMovie(m);

  const titleTxt = movie
    ? `${(movie.displayTitle?.trim() || movie.title) as string}${
        movie.year ? ` (${movie.year})` : ''
      }`
    : 'Family Movie Night';
  const descParts: string[] = [];
  if (movie?.rottenTomatoes) descParts.push(`RT ${movie.rottenTomatoes}`);
  else if (movie?.imdb) descParts.push(`IMDb ${movie.imdb}`);
  if (movie?.commonSenseAge) descParts.push(movie.commonSenseAge as string);
  const desc =
    descParts.length > 0
      ? descParts.join(' — ')
      : 'Our family movie night tracker';
  const img =
    (movie?.poster as string | undefined) || `${origin}/apple-touch-icon.png`;
  const canonical = `${origin}/?m=${encodeURIComponent(m)}`;

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

  // Append the dynamic tags just before </head>. Placing them after
  // the static OG fallbacks in index.html means unfurlers that use
  // "last wins" rules pick the movie-specific values.
  const out = html.replace('</head>', `    ${tags}\n  </head>`);

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader(
    'cache-control',
    'public, s-maxage=300, stale-while-revalidate=86400',
  );
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

async function lookupMovie(title: string): Promise<MovieLike | null> {
  if (!title || !supabaseUrl || !supabaseKey) return null;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('movie_night')
      .select('movies')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return null;
    const movies = (data.movies ?? []) as MovieLike[];
    return movies.find((x) => x?.title === title) ?? null;
  } catch {
    return null;
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
