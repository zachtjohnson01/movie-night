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
  canWrite: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

function deriveStatus(session: Session | null): AuthStatus {
  if (!session) return 'signed-out';
  const email = session.user.email?.toLowerCase() ?? '';
  return ALLOWED_EMAILS.includes(email) ? 'signed-in' : 'unauthorized';
}

export function useAuth(): AuthApi {
  const [status, setStatus] = useState<AuthStatus>(
    supabase ? 'loading' : 'signed-out',
  );
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setStatus(deriveStatus(data.session));
      setEmail(data.session?.user.email ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(deriveStatus(session));
      setEmail(session?.user.email ?? null);
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
    canWrite: status === 'signed-in',
    signIn,
    signOut,
  };
}
