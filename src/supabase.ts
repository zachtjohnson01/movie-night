import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Project ref derived from the Supabase URL host (e.g. `xxxxx.supabase.co`
// → `xxxxx`). supabase-js v2 persists sessions in localStorage under
// `sb-<ref>-auth-token`, so knowing the ref lets us synchronously peek
// for a session at app boot — before `getSession()`'s Promise resolves.
const projectRef = (() => {
  if (!url) return null;
  try {
    return new URL(url).host.split('.')[0] || null;
  } catch {
    return null;
  }
})();

/**
 * Synchronous probe for a stored Supabase session. Used at app boot to
 * decide whether the landing page is safe to render: if a token is in
 * localStorage, the user is probably signed in and `useAuth` will
 * redirect them off `/` once memberships resolve. Rendering the
 * marketing landing in the meantime causes a visible flash.
 *
 * Returns false on the no-supabase, no-token, and storage-blocked
 * cases — anywhere the redirect won't fire, so Landing should render.
 */
export function hasStoredSupabaseSession(): boolean {
  if (typeof window === 'undefined' || !projectRef) return false;
  try {
    const v = window.localStorage.getItem(`sb-${projectRef}-auth-token`);
    return Boolean(v && v.length > 2);
  } catch {
    return false;
  }
}

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
