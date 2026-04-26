import { useEffect, useMemo } from 'react';
import { pathFromRoute, pushPath, replacePath } from '../router';
import type { AuthApi, FamilyMembership } from '../useAuth';
import { useFamilyMembers } from '../useFamilyMembers';
import AddMemberForm from './AddMemberForm';
import MemberRow from './MemberRow';

type Props = {
  slug: string;
  familyId: string | null;
  membership: FamilyMembership | null;
  auth: AuthApi;
  familyKnown: boolean;
};

/**
 * Admin-only screen at `/family/<slug>/settings`. Lets the family
 * admin invite members by email, change roles, and remove members.
 *
 * Bounce rules:
 *   - signed-out → /family/<slug> (public read view)
 *   - signed-in non-admin → /family/<slug>
 *   - unknown family slug → /
 *
 * The membership lookup happens in App.tsx; this component is only
 * mounted inside that bounce check, but it also re-runs the guard
 * locally so a mid-session role demotion doesn't strand someone here.
 */
export default function FamilySettings({
  slug,
  familyId,
  membership,
  auth,
  familyKnown,
}: Props) {
  // Bounce non-admins. Wait for auth to leave loading so a brief
  // pre-load flash doesn't kick a real admin out.
  useEffect(() => {
    if (auth.status === 'loading') return;
    if (!familyKnown) {
      replacePath('/');
      return;
    }
    if (!membership || membership.role !== 'admin') {
      replacePath(pathFromRoute({ kind: 'family', slug }));
    }
  }, [auth.status, familyKnown, membership, slug]);

  // Only fetch members once we know the user is authorized — prevents
  // a moment of querying with the wrong identity if auth flips fast.
  const isAdmin = membership?.role === 'admin';
  const api = useFamilyMembers(isAdmin ? familyId : null);

  const adminCount = useMemo(
    () => api.members.filter((m) => m.role === 'admin').length,
    [api.members],
  );
  const sorted = useMemo(() => {
    return [...api.members].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
      const an = a.displayName ?? a.email;
      const bn = b.displayName ?? b.email;
      return an.localeCompare(bn);
    });
  }, [api.members]);
  const existingEmails = useMemo(
    () => api.members.map((m) => m.email),
    [api.members],
  );
  const me = auth.email?.toLowerCase() ?? null;

  if (auth.status === 'loading') return null;
  if (!isAdmin || !familyId || !familyKnown) return null;

  return (
    <div className="mx-auto max-w-xl pb-8">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              pushPath(pathFromRoute({ kind: 'family', slug }))
            }
            aria-label="Back"
            className="shrink-0 w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-ink-200 active:bg-ink-800"
          >
            <svg
              viewBox="0 0 24 24"
              width={22}
              height={22}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold truncate">
              {membership.familyName}
            </div>
            <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight">
              Family settings
            </h1>
            <div className="mt-1 text-[11px] text-ink-500 tabular-nums">
              <span className="text-ink-300 font-semibold">
                {api.members.length}
              </span>{' '}
              member{api.members.length === 1 ? '' : 's'} ·{' '}
              <span className="text-ink-300 font-semibold">{adminCount}</span>{' '}
              admin
            </div>
          </div>
        </div>
      </header>

      <section className="px-5 pt-4">
        <AddMemberForm existingEmails={existingEmails} onAdd={api.addMember} />
      </section>

      <ul className="mt-2">
        {sorted.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isMe={m.email.toLowerCase() === me}
            isLastAdmin={m.role === 'admin' && adminCount <= 1}
            onUpdateRole={api.updateRole}
            onRemove={api.removeMember}
          />
        ))}
      </ul>

      {api.status === 'synced' && api.members.length === 0 && (
        <div className="px-6 pt-10 text-center text-ink-400 text-sm">
          No members yet.
        </div>
      )}
      {api.status === 'error' && (
        <div className="px-6 pt-6 text-center text-rose-300 text-sm">
          Couldn&apos;t load members. Check your connection and try again.
        </div>
      )}
    </div>
  );
}
