import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isSupabaseConfigured,
  supabase,
  MOVIE_NIGHT_TABLE,
  USER_ROLES_ROW_ID,
} from './supabase';

export type UserRole = 'admin' | 'editor';

export type UserRoleEntry = {
  email: string;
  role: UserRole;
};

export type UserRolesStatus = 'local' | 'loading' | 'synced' | 'error';

export type UserRolesApi = {
  roles: UserRoleEntry[];
  status: UserRolesStatus;
  upsertRole: (email: string, role: UserRole) => Promise<void>;
  removeRole: (email: string) => Promise<void>;
};

// First-run seed: zach is admin so he can manage the rest, alex keeps her
// existing editor access from the old hardcoded allowlist. Anyone else
// gets read-only until an admin adds them.
const SEED_ROLES: UserRoleEntry[] = [
  { email: 'zachtjohnson01@gmail.com', role: 'admin' },
  { email: 'alexandrabjohnson01@gmail.com', role: 'editor' },
];

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'editor';
}

function coerceRoles(stored: unknown): UserRoleEntry[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const email = typeof r.email === 'string' ? normalize(r.email) : '';
      if (!email) return null;
      const role = isUserRole(r.role) ? r.role : 'editor';
      return { email, role } satisfies UserRoleEntry;
    })
    .filter((r): r is UserRoleEntry => r !== null);
}

/**
 * Reads, subscribes to, and writes the user-role list at row id=5.
 *
 * Local mode (no Supabase): returns SEED_ROLES so a dev environment still
 * has a working admin without a backend.
 */
export function useUserRoles(): UserRolesApi {
  const [roles, setRoles] = useState<UserRoleEntry[]>(
    isSupabaseConfigured ? [] : SEED_ROLES,
  );
  const [status, setStatus] = useState<UserRolesStatus>(
    isSupabaseConfigured ? 'loading' : 'local',
  );
  const latestRef = useRef<UserRoleEntry[]>(roles);
  latestRef.current = roles;

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setStatus('loading');

    async function load() {
      if (!supabase) return;
      const { data, error } = await supabase
        .from(MOVIE_NIGHT_TABLE)
        .select('movies')
        .eq('id', USER_ROLES_ROW_ID)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('[useUserRoles] load failed', error);
        setStatus('error');
        return;
      }

      const stored = data?.movies as unknown;
      const parsed = coerceRoles(stored);

      if (parsed.length === 0) {
        // Row missing or empty — seed it so future reads are stable and so
        // zach is an admin from the very first session.
        const { error: seedError } = await supabase
          .from(MOVIE_NIGHT_TABLE)
          .upsert({ id: USER_ROLES_ROW_ID, movies: SEED_ROLES });
        if (cancelled) return;
        if (seedError) {
          console.error('[useUserRoles] seed failed', seedError);
          // Still expose the seed locally — useAuth's BOOTSTRAP_ADMIN
          // safety net keeps zach unlocked even if Supabase is unhappy.
          setRoles(SEED_ROLES);
          latestRef.current = SEED_ROLES;
          setStatus('error');
          return;
        }
        setRoles(SEED_ROLES);
        latestRef.current = SEED_ROLES;
        setStatus('synced');
        return;
      }

      setRoles(parsed);
      latestRef.current = parsed;
      setStatus('synced');
    }

    void load();

    const channel = supabase
      .channel('user_roles_updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: MOVIE_NIGHT_TABLE,
          filter: `id=eq.${USER_ROLES_ROW_ID}`,
        },
        (payload) => {
          const next = coerceRoles((payload.new as { movies?: unknown }).movies);
          setRoles(next);
          latestRef.current = next;
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (supabase) void supabase.removeChannel(channel);
    };
  }, []);

  const writeRemote = useCallback(async (next: UserRoleEntry[]) => {
    if (!supabase) return;
    const { error } = await supabase
      .from(MOVIE_NIGHT_TABLE)
      .update({ movies: next })
      .eq('id', USER_ROLES_ROW_ID);
    if (error) {
      console.error('[useUserRoles] write failed', error);
      setStatus('error');
    } else {
      setStatus('synced');
    }
  }, []);

  const upsertRole = useCallback(
    async (email: string, role: UserRole) => {
      const e = normalize(email);
      if (!e) return;
      const existing = latestRef.current;
      const idx = existing.findIndex((r) => r.email === e);
      const next =
        idx >= 0
          ? existing.map((r, i) => (i === idx ? { email: e, role } : r))
          : [...existing, { email: e, role }];
      setRoles(next);
      latestRef.current = next;
      await writeRemote(next);
    },
    [writeRemote],
  );

  const removeRole = useCallback(
    async (email: string) => {
      const e = normalize(email);
      const next = latestRef.current.filter((r) => r.email !== e);
      setRoles(next);
      latestRef.current = next;
      await writeRemote(next);
    },
    [writeRemote],
  );

  return { roles, status, upsertRole, removeRole };
}
