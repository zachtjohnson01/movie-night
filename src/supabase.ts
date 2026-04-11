import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Supabase client, or null if env vars are missing. When null, the app
 * falls back to in-memory state seeded from the bundled movies.json so
 * the PWA still renders correctly during first-time setup.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

// The entire app state lives in a single row of a single table so there
// are no schemas to migrate and no conflict resolution beyond
// last-write-wins — which is fine for a two-person family movie list.
export const MOVIE_NIGHT_TABLE = 'movie_night';
export const MOVIE_NIGHT_ROW_ID = 1;
