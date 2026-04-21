import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Only these two emails can add, edit, delete, or mark movies as watched.
// Everyone else gets a read-only view. Enforced in Supabase RLS as well;
// the client check is purely UI hygiene.
const ALLOWED_EMAILS = [
  'zachtjohnson01@gmail.com',
  'alexandrabjohnson01@gmail.com',
];

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
  canWrite: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

function deriveStatus(session: Session | null): AuthStatus {
  if (!session) return 'signed-out';
  const email = session.user.email?.toLowerCase() ?? '';
  return ALLOWED_EMAILS.includes(email) ? 'signed-in' : 'unauthorized';
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

export function useAuth(): AuthApi {
  const [status, setStatus] = useState<AuthStatus>(
    supabase ? 'loading' : 'signed-out',
  );
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setStatus(deriveStatus(data.session));
      const profile = extractProfile(data.session);
      setEmail(profile.email);
      setName(profile.name);
      setAvatarUrl(profile.avatarUrl);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(deriveStatus(session));
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
      options: { redirectTo: window.location.origin },
    });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  return {
    status,
    email,
    name,
    avatarUrl,
    canWrite: status === 'signed-in',
    signIn,
    signOut,
  };
}
