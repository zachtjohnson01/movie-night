import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { UserRole, UserRoleEntry } from './useUserRoles';

// Bootstrap fallback: if the user_roles row is missing, errored, or has
// somehow been wiped, this email is still treated as admin so we can
// never lock ourselves out of the Manage Users UI.
const BOOTSTRAP_ADMIN = 'zachtjohnson01@gmail.com';

export type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'unauthorized'
  | 'signed-in';

export type AuthApi = {
  status: AuthStatus;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole | null;
  canWrite: boolean;
  isOwner: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

function lookupRole(
  email: string | null | undefined,
  roles: UserRoleEntry[],
): UserRole | null {
  if (!email) return null;
  const lower = email.toLowerCase();
  const hit = roles.find((r) => r.email === lower);
  if (hit) return hit.role;
  // Bootstrap safety net — see BOOTSTRAP_ADMIN comment above.
  if (lower === BOOTSTRAP_ADMIN) return 'admin';
  return null;
}

function extractProfile(session: Session | null): {
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
} {
  if (!session) return { email: null, name: null, avatarUrl: null };
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const pick = (key: string) =>
    typeof meta[key] === 'string' ? (meta[key] as string) : null;
  return {
    email: session.user.email ?? null,
    name: pick('full_name') ?? pick('name') ?? null,
    avatarUrl: pick('avatar_url') ?? pick('picture') ?? null,
  };
}

export function useAuth(roles: UserRoleEntry[]): AuthApi {
  const [hasSession, setHasSession] = useState<boolean | null>(
    supabase ? null : false,
  );
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      const profile = extractProfile(data.session);
      setEmail(profile.email);
      setName(profile.name);
      setAvatarUrl(profile.avatarUrl);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
      const profile = extractProfile(session);
      setEmail(profile.email);
      setName(profile.name);
      setAvatarUrl(profile.avatarUrl);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Land on a dedicated callback route so App.tsx can pick up the
      // session and route the user appropriately (back to where they
      // started, on to onboarding, etc.) without conflating with normal
      // landing-page navigation.
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const role = lookupRole(email, roles);
  let status: AuthStatus;
  if (hasSession === null) status = 'loading';
  else if (!hasSession) status = 'signed-out';
  else if (role) status = 'signed-in';
  else status = 'unauthorized';

  return {
    status,
    email,
    name,
    avatarUrl,
    role,
    canWrite: status === 'signed-in',
    isOwner: status === 'signed-in' && role === 'admin',
    signIn,
    signOut,
  };
}
