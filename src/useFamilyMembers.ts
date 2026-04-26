import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';

export type FamilyMemberRole = 'admin' | 'member';

export type FamilyMember = {
  id: string;
  email: string;
  displayName: string | null;
  role: FamilyMemberRole;
  isGlobalOwner: boolean;
  userId: string | null;
  joinedAt: string | null;
  createdAt: string;
};

export type FamilyMembersStatus = 'loading' | 'synced' | 'error' | 'local';

export type FamilyMembersApi = {
  members: FamilyMember[];
  status: FamilyMembersStatus;
  addMember: (email: string) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  updateRole: (memberId: string, role: FamilyMemberRole) => Promise<void>;
};

type FamilyMemberRow = {
  id: string;
  family_id: string;
  user_id: string | null;
  email: string;
  display_name: string | null;
  role: FamilyMemberRole;
  is_global_owner: boolean;
  joined_at: string | null;
  created_at: string;
};

function fromRow(r: FamilyMemberRow): FamilyMember {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    isGlobalOwner: r.is_global_owner === true,
    userId: r.user_id,
    joinedAt: r.joined_at,
    createdAt: r.created_at,
  };
}

/**
 * Lists `family_members` rows for one family with realtime updates and
 * admin-side mutations (invite by email, remove, change role). Mirrors
 * the layout of `useMovies`: snapshot fetch, realtime channel scoped
 * to this family, mutating helpers that round-trip to Postgres and let
 * the channel feed state back.
 *
 * `familyId` may be null while the slug → UUID resolution is in flight
 * or when the caller hasn't authorized this hook (non-admin viewing
 * settings) — the hook short-circuits to an empty list in that case
 * so the component can render its bounce-out without firing a query.
 */
export function useFamilyMembers(familyId: string | null): FamilyMembersApi {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [status, setStatus] = useState<FamilyMembersStatus>(
    isSupabaseConfigured ? 'loading' : 'local',
  );
  const latestRef = useRef<FamilyMember[]>([]);
  latestRef.current = members;

  useEffect(() => {
    if (!supabase || !familyId) {
      setMembers([]);
      latestRef.current = [];
      setStatus(isSupabaseConfigured ? 'loading' : 'local');
      return;
    }
    let cancelled = false;
    setStatus('loading');

    async function load() {
      if (!supabase || !familyId) return;
      const { data, error } = await supabase
        .from('family_members')
        .select(
          'id, family_id, user_id, email, display_name, role, is_global_owner, joined_at, created_at',
        )
        .eq('family_id', familyId)
        .order('created_at');
      if (cancelled) return;
      if (error) {
        console.error('[useFamilyMembers] load failed', error);
        setStatus('error');
        return;
      }
      const next = ((data ?? []) as FamilyMemberRow[]).map(fromRow);
      setMembers(next);
      latestRef.current = next;
      setStatus('synced');
    }

    void load();

    // Realtime filter narrows on family_id. INSERT/UPDATE/DELETE all
    // matter — admins invite (insert), members bind on first sign-in
    // (update), admins remove (delete).
    const channel = supabase
      .channel(`family_members_${familyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'family_members',
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as FamilyMemberRow;
            const existing = latestRef.current;
            if (existing.some((m) => m.id === row.id)) return;
            const next = [...existing, fromRow(row)];
            setMembers(next);
            latestRef.current = next;
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as FamilyMemberRow;
            const next = latestRef.current.map((m) =>
              m.id === row.id ? fromRow(row) : m,
            );
            setMembers(next);
            latestRef.current = next;
          } else if (payload.eventType === 'DELETE') {
            const row = payload.old as Partial<FamilyMemberRow>;
            if (!row.id) return;
            const next = latestRef.current.filter((m) => m.id !== row.id);
            setMembers(next);
            latestRef.current = next;
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (supabase) void supabase.removeChannel(channel);
    };
  }, [familyId]);

  const addMember = useCallback(
    async (email: string) => {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed || !trimmed.includes('@')) {
        throw new Error('Enter a valid email');
      }
      if (!supabase || !familyId) {
        throw new Error('Not connected');
      }
      const { error } = await supabase.from('family_members').insert({
        family_id: familyId,
        email: trimmed,
        role: 'member',
      });
      if (error) {
        console.error('[useFamilyMembers] add failed', error);
        setStatus('error');
        throw error;
      }
    },
    [familyId],
  );

  const removeMember = useCallback(async (memberId: string) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('family_members')
      .delete()
      .eq('id', memberId);
    if (error) {
      console.error('[useFamilyMembers] remove failed', error);
      setStatus('error');
      throw error;
    }
  }, []);

  const updateRole = useCallback(
    async (memberId: string, role: FamilyMemberRole) => {
      if (!supabase) return;
      const { error } = await supabase
        .from('family_members')
        .update({ role })
        .eq('id', memberId);
      if (error) {
        console.error('[useFamilyMembers] role update failed', error);
        setStatus('error');
        throw error;
      }
    },
    [],
  );

  return { members, status, addMember, removeMember, updateRole };
}
