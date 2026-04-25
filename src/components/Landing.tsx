import { useFamilies } from '../useFamilies';
import FamilyCard from './FamilyCard';
import type { AuthApi } from '../useAuth';

type Props = {
  auth: AuthApi;
};

/**
 * Public landing page. Lists every family on the platform with a
 * clickable card linking to that family's read-only view. Header
 * doubles as the sign-in CTA; signed-in users see their email +
 * a sign-out button.
 *
 * Sign-up flow (creating a brand-new family) lands in PR 5; for now
 * the only families are the bootstrap "Johnsons" plus whatever the
 * dashboard has seeded.
 */
export default function Landing({ auth }: Props) {
  const { families, status } = useFamilies();

  return (
    <div className="min-h-full flex flex-col">
      <header
        className="px-5 pt-2 pb-3 border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <div className="mx-auto max-w-xl flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-crimson-bright/90 font-bold">
              Family Movie Night
            </div>
            <div className="mt-1 text-lg font-semibold text-ink-100 leading-tight">
              Browse our movie nights
            </div>
          </div>
          <AuthControls auth={auth} />
        </div>
      </header>

      <main className="flex-1 px-5 py-6">
        <div className="mx-auto max-w-xl space-y-3">
          {status === 'loading' && (
            <div className="text-sm text-ink-500 italic">Loading…</div>
          )}
          {status === 'error' && (
            <div className="rounded-2xl bg-rose-950/40 border border-rose-900/60 px-4 py-3 text-sm text-rose-200">
              Couldn&apos;t load families. Try refreshing.
            </div>
          )}
          {status === 'local' && (
            <div className="rounded-2xl bg-amber-glow/10 border border-amber-glow/30 px-4 py-3 text-sm text-amber-glow">
              Local mode — Supabase isn&apos;t configured, so there&apos;s
              nothing to list.
            </div>
          )}
          {(status === 'synced' || status === 'local') &&
            families.length === 0 && (
              <div className="text-sm text-ink-500 italic">
                No families yet.
              </div>
            )}
          {families.map((f) => (
            <FamilyCard key={f.id} family={f} />
          ))}
        </div>
      </main>
    </div>
  );
}

function AuthControls({ auth }: { auth: AuthApi }) {
  if (auth.status === 'loading') return null;
  if (auth.status === 'signed-in' || auth.status === 'unauthorized') {
    return (
      <button
        type="button"
        onClick={auth.signOut}
        className="shrink-0 min-h-[36px] px-3 rounded-lg bg-ink-800 border border-ink-700 text-ink-200 font-semibold text-xs active:bg-ink-700"
      >
        Sign out
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={auth.signIn}
      className="shrink-0 min-h-[36px] px-3 rounded-lg bg-amber-glow text-ink-950 font-semibold text-xs active:opacity-80"
    >
      Sign in
    </button>
  );
}
