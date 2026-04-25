import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type FamilyRole = 'admin' | 'member';

export type FamilyMembershipApi = {
  role: FamilyRole | null;
  canWrite: boolean;
  isGlobalOwner: boolean;
  status: 'loading' | 'ready';
};

type MemberRow = {
  role: FamilyRole;
  is_global_owner: boolean;
};

/**
 * Resolves the signed-in user's role in `familyId` by reading
 * `family_members`. Drives `canWrite` (any non-null role) and
 * `isGlobalOwner` (paid-feature gate, intentionally per-family-row even
 * though the column is independent of role).
 *
 * Anonymous viewers, signed-in users who aren't members, and missing
 * `familyId` all collapse to `{ role: null, canWrite: false }` so the
 * landing page and public family pages render read-only.
 *
 * PR 5 will fold this into `useAuth` (memberships array on the auth
 * object). For now it stays separate because PR 4's job is just to
 * stop hardcoding write access against the email allowlist.
 */
export function useFamilyMembership({
  email,
  familyId,
}: {
  email: string | null;
  familyId: string | null;
}): FamilyMembershipApi {
  const [row, setRow] = useState<MemberRow | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>(
    supabase && email && familyId ? 'loading' : 'ready',
  );

  useEffect(() => {
    if (!supabase || !email || !familyId) {
      setRow(null);
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      const { data, error } = await supabase!
        .from('family_members')
        .select('role, is_global_owner')
        .eq('family_id', familyId)
        .eq('email', email.toLowerCase())
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('[useFamilyMembership] load failed', error);
        setRow(null);
        setStatus('ready');
        return;
      }
      setRow((data as MemberRow | null) ?? null);
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [email, familyId]);

  return {
    role: row?.role ?? null,
    canWrite: row != null,
    isGlobalOwner: row?.is_global_owner ?? false,
    status,
  };
}
