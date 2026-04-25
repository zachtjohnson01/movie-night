import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const JOHNSON_FAMILY_UUID = '00000001-0000-0000-0000-000000000001';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase
    .from('movie_night')
    .select('movies')
    .eq('family_id', JOHNSON_FAMILY_UUID)
    .eq('kind', 'library')
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const movies = (data?.movies ?? []) as Array<Record<string, unknown>>;
  const watched = movies.filter((m) => m.watched === true);

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.json({
    count: watched.length,
    lastUpdated: new Date().toISOString(),
    movies: watched,
  });
}
