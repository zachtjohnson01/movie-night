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
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

export const MOVIE_NIGHT_TABLE = 'movie_night';

/**
 * Stable UUID for the bootstrap "Johnsons" family — written by the
 * 20260425000000_multi_family migration. Hardcoded here so the app can
 * scope its library queries to the right family before per-slug
 * resolution lands in PR 4.
 */
export const JOHNSON_FAMILY_UUID = '00000001-0000-0000-0000-000000000001';

/**
 * The `kind` discriminator on `movie_night`. Library rows are
 * per-family; pool / reasons / weights stay global with
 * `family_id IS NULL`. Enforced by the migration's check constraint
 * and partial unique indexes.
 */
export type MovieNightKind = 'library' | 'pool' | 'reasons' | 'weights';
