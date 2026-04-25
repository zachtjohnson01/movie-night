import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Family-prefixed poster proxy: `/api/poster/f/<slug>/<title>.jpg`.
 * Companion to `/share/f/<slug>/<title>` — used by non-Johnson families
 * so the unfurl image resolves against the correct library + global
 * pool. Default Johnsons posters stay on `/api/poster/<title>.jpg`.
 *
 * Inlined for the same Vercel-bundler reason as the sibling routes.
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const JOHNSON_FAMILY_UUID = '00000001-0000-0000-0000-000000000001';
const DEFAULT_FAMILY_SLUG = 'johnson';

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

function normalizeTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

function rewritePosterSize(url: string): string {
  return url.replace(/_SX\d+/, '_SX600');
}

async function resolveFamilyId(
  supabase: SupabaseClient,
  slug: string,
): Promise<string | null> {
  if (slug === DEFAULT_FAMILY_SLUG) return JOHNSON_FAMILY_UUID;
  const { data, error } = await supabase
    .from('families')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

async function lookupPosterUrl(
  slug: string,
  title: string,
): Promise<{ poster: string | null; entryMatch: string }> {
  if (!title || !slug || !supabaseUrl || !supabaseKey) {
    return { poster: null, entryMatch: 'no-env' };
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const familyId = await resolveFamilyId(supabase, slug);
  if (!familyId) {
    return { poster: null, entryMatch: 'unknown-slug' };
  }
  const { data, error } = await supabase
    .from('movie_night')
    .select('family_id, kind, movies')
    .in('kind', ['library', 'pool']);
  if (error || !data) {
    return { poster: null, entryMatch: error ? 'supabase-error' : 'no-data' };
  }
  const rows = data as MovieNightRow[];
  const libRow = rows.find(
    (r) => r.kind === 'library' && r.family_id === familyId,
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

function decodeParam(raw: string | string[] | undefined): string {
  const v =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? (raw[0] ?? '')
        : '';
  return decodeURIComponent(v);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  res.setHeader('x-commit', commit);

  const debug = req.query.debug === '1';
  try {
    const slug = decodeParam(req.query.slug);
    const titleParam = decodeParam(req.query.title);
    const title = titleParam.replace(/\.(jpg|jpeg|png|webp)$/i, '');

    if (debug) {
      const lookup = title
        ? await lookupPosterUrl(slug, title)
        : { poster: null, entryMatch: 'no-title' };
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return res.status(200).json({
        commit,
        slug,
        title,
        ...lookup,
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseKey: Boolean(supabaseKey),
      });
    }

    if (!title || !slug) {
      res.setHeader('access-control-allow-origin', '*');
      return res.status(400).send('missing slug or title');
    }

    const { poster: posterRawUrl, entryMatch } = await lookupPosterUrl(
      slug,
      title,
    );
    if (!posterRawUrl) {
      res.setHeader('access-control-allow-origin', '*');
      return res
        .status(404)
        .send(`poster not found for "${slug}/${title}" (match=${entryMatch})`);
    }

    const posterUrl = rewritePosterSize(posterRawUrl);

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
