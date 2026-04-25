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

// The entire app state lives in a single row of a single table so there
// are no schemas to migrate and no conflict resolution beyond
// last-write-wins — which is fine for a two-person family movie list.
export const MOVIE_NIGHT_TABLE = 'movie_night';
export const MOVIE_NIGHT_ROW_ID = 1;
/**
 * Row id=2 in the same `movie_night` table holds the deterministic
 * recommendation pool (a `Candidate[]` JSONB blob). Reusing the same
 * table keeps the no-schema-migrations property intact.
 */
export const CANDIDATE_POOL_ROW_ID = 2;
/**
 * Row id=3 stores the removal-reason vocabulary as a `string[]` inside
 * the same `movies` JSONB column. Typing a new reason on a candidate's
 * Remove-from-pool section appends to this list so it becomes a reusable
 * checkbox the next time an admin removes a candidate.
 */
export const REMOVAL_REASONS_ROW_ID = 3;
/**
 * Row id=4 stores the scoring weights as a `ScoringWeights` JSON object.
 * Persisting them here lets the For You display and the ranking model stay
 * in sync automatically — changing a weight in the DB propagates to both.
 */
export const SCORING_WEIGHTS_ROW_ID = 4;
/**
 * Row id=5 stores the user role list as `{ email, role }[]`. The admin
 * UI mutates this row to grant or revoke access; useAuth reads it on
 * every auth-state change so the allowlist is no longer hardcoded.
 */
export const USER_ROLES_ROW_ID = 5;
