import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export type FamilyRole = 'admin' | 'member';

export type FamilyMembership = {
  familyId: string;
  familySlug: string;
  familyName: string;
  role: FamilyRole;
  isGlobalOwner: boolean;
};

export type AuthApi = {
  status: AuthStatus;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  userId: string | null;
  memberships: FamilyMembership[];
  isGlobalOwner: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  createFamily: (name: string, slug: string) => Promise<FamilyMembership>;
};

type MembershipRow = {
  role: FamilyRole;
  is_global_owner: boolean;
  families: { id: string; slug: string; name: string } | null;
};

function extractProfile(session: Session | null): {
  userId: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
} {
  if (!session) {
    return { userId: null, email: null, name: null, avatarUrl: null };
  }
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const pick = (key: string) =>
    typeof meta[key] === 'string' ? (meta[key] as string) : null;
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    name: pick('full_name') ?? pick('name') ?? null,
    avatarUrl: pick('avatar_url') ?? pick('picture') ?? null,
  };
}

async function loadMemberships(userId: string): Promise<FamilyMembership[]> {
  if (!supabase) return [];
  // `families!inner` joins via the FK on family_members.family_id and
  // drops any orphaned rows (shouldn't happen, but the DB allows it).
  const { data, error } = await supabase
    .from('family_members')
    .select('role, is_global_owner, families!inner(id, slug, name)')
    .eq('user_id', userId);
  if (error) {
    console.error('[useAuth] memberships load failed', error);
    return [];
  }
  const rows = (data ?? []) as unknown as MembershipRow[];
  const out: FamilyMembership[] = [];
  for (const r of rows) {
    if (!r.families) continue;
    out.push({
      familyId: r.families.id,
      familySlug: r.families.slug,
      familyName: r.families.name,
      role: r.role,
      isGlobalOwner: r.is_global_owner === true,
    });
  }
  return out;
}

/**
 * Membership-driven auth. The OAuth session gives us identity; the
 * `family_members` table tells us which families the user can write to
 * and whether they hold the global-owner flag (paid Anthropic / OMDB
 * features). `claim_pending_memberships` runs after every sign-in to
 * bind admin-invited rows whose `user_id` is null until first visit.
 *
 * `status` stays in 'loading' until BOTH the session is resolved AND
 * memberships have been fetched, so consumers can rely on
 * `memberships.length === 0` as a real signal (first-time sign-up
 * needing onboarding) rather than a transient mid-load state.
 */
export function useAuth(): AuthApi {
  const [hasSession, setHasSession] = useState<boolean | null>(
    supabase ? null : false,
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<FamilyMembership[]>([]);
  const [membershipsResolved, setMembershipsResolved] = useState<boolean>(
    !supabase,
  );

  // Signal cancellation across re-renders: an in-flight refresh from a
  // stale userId shouldn't overwrite state from a fresh sign-in/out.
  const refreshTokenRef = useRef(0);

  const refreshMemberships = useCallback(async (uid: string | null) => {
    const token = ++refreshTokenRef.current;
    if (!uid) {
      setMemberships([]);
      setMembershipsResolved(true);
      return;
    }
    if (supabase) {
      try {
        await supabase.rpc('claim_pending_memberships');
      } catch (e) {
        console.error('[useAuth] claim_pending_memberships failed', e);
      }
    }
    const fresh = await loadMemberships(uid);
    if (refreshTokenRef.current !== token) return;
    setMemberships(fresh);
    setMembershipsResolved(true);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const profile = extractProfile(data.session);
      setHasSession(Boolean(data.session));
      setUserId(profile.userId);
      setEmail(profile.email);
      setName(profile.name);
      setAvatarUrl(profile.avatarUrl);
      if (profile.userId) {
        await refreshMemberships(profile.userId);
      } else {
        setMembershipsResolved(true);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (cancelled) return;
        const profile = extractProfile(session);
        setHasSession(Boolean(session));
        setUserId(profile.userId);
        setEmail(profile.email);
        setName(profile.name);
        setAvatarUrl(profile.avatarUrl);
        if (profile.userId) {
          setMembershipsResolved(false);
          await refreshMemberships(profile.userId);
        } else {
          // Bump the token so any in-flight refresh from a prior session
          // can't overwrite the post-signout empty state.
          refreshTokenRef.current += 1;
          setMemberships([]);
          setMembershipsResolved(true);
        }
      },
    );

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [refreshMemberships]);

  const signIn = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Land on a dedicated callback route so App.tsx can steer the
      // user to onboarding (if no memberships) or back to the landing
      // page once auth + memberships have resolved.
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const createFamily = useCallback(
    async (familyName: string, familySlug: string): Promise<FamilyMembership> => {
      if (!supabase) throw new Error('Supabase is not configured');
      if (!userId) throw new Error('Sign in to create a family');
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        'create_family',
        { p_name: familyName, p_slug: familySlug },
      );
      if (rpcErr) throw rpcErr;
      const newId = rpcData as string;
      // Re-read the canonical row — the RPC normalizes slug (lower +
      // trim) and trims name, so trust the DB over the user input.
      const { data: famData, error: famErr } = await supabase
        .from('families')
        .select('id, slug, name')
        .eq('id', newId)
        .single();
      if (famErr || !famData) {
        throw famErr ?? new Error('Failed to load new family');
      }
      const fam = famData as { id: string; slug: string; name: string };
      const newMembership: FamilyMembership = {
        familyId: fam.id,
        familySlug: fam.slug,
        familyName: fam.name,
        role: 'admin',
        isGlobalOwner: false,
      };
      setMemberships((prev) => {
        const filtered = prev.filter(
          (m) => m.familyId !== newMembership.familyId,
        );
        return [...filtered, newMembership];
      });
      return newMembership;
    },
    [userId],
  );

  let status: AuthStatus;
  if (hasSession === null) status = 'loading';
  else if (!hasSession) status = 'signed-out';
  else if (!membershipsResolved) status = 'loading';
  else status = 'signed-in';

  const isGlobalOwner = memberships.some((m) => m.isGlobalOwner);

  return {
    status,
    email,
    name,
    avatarUrl,
    userId,
    memberships,
    isGlobalOwner,
    signIn,
    signOut,
    createFamily,
  };
}
