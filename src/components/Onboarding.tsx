import { useEffect, useMemo, useState } from 'react';
import type { AuthApi } from '../useAuth';
import { pathFromRoute, pushPath, replacePath } from '../router';

type Props = {
  auth: AuthApi;
};

/**
 * Single-screen sign-up: pick a family name, derive a slug, call
 * `create_family`, then jump to the new family's view. The slug is
 * auto-generated from the name (kebab-case ASCII) and shown as a
 * preview so the user understands what their URL will be.
 *
 * Reserved-slug enforcement is out of scope for this PR — the schema
 * accepts anything unique. A future PR adds a denylist (`api`,
 * `admin`, `share`, `f`, `auth`, `onboard`).
 */
export default function Onboarding({ auth }: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the user already has memberships (e.g. landed here after a
  // bookmark, but they're already an admin or member somewhere), bail
  // out to that family so we don't sit on a redundant onboarding form.
  // Wait for `auth.status` to leave 'loading' so a brief pre-load
  // flash doesn't cause a misroute.
  useEffect(() => {
    if (auth.status === 'loading') return;
    if (auth.status === 'signed-in' && auth.memberships.length > 0) {
      const first = auth.memberships[0];
      replacePath(pathFromRoute({ kind: 'family', slug: first.familySlug }));
    }
  }, [auth.status, auth.memberships]);

  const slug = useMemo(() => slugify(name), [name]);
  const canSubmit =
    auth.status === 'signed-in' && name.trim().length > 0 && slug.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const membership = await auth.createFamily(name.trim(), slug);
      pushPath(
        pathFromRoute({ kind: 'family', slug: membership.familySlug }),
      );
    } catch (err) {
      console.error('[Onboarding] create_family failed', err);
      const message =
        (err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : '') || 'Something went wrong. Try again.';
      // Postgres unique-violation surfaces with code 23505 and a
      // human-readable message; show whatever Supabase sent.
      setError(
        /duplicate|unique/i.test(message)
          ? 'That name is already taken. Try another.'
          : message,
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col bg-ink-950">
      <header
        className="px-5 pt-2 pb-3 border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      >
        <div className="mx-auto max-w-xl">
          <div className="text-[11px] uppercase tracking-[0.22em] text-crimson-bright/90 font-bold">
            Family Movie Night
          </div>
          <div className="mt-1 text-lg font-semibold text-ink-100 leading-tight">
            Create your family
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 py-6">
        <div className="mx-auto max-w-xl space-y-5">
          <p className="text-sm text-ink-300 leading-relaxed">
            Pick a family name. You&apos;ll be the admin and can invite
            members from the family settings later.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="onboard-name"
                className="block text-[11px] uppercase tracking-[0.18em] text-ink-500 font-bold mb-1"
              >
                Family name
              </label>
              <input
                id="onboard-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                placeholder="The Smiths"
                disabled={submitting}
                className="block w-full rounded-xl bg-ink-800 border border-ink-700 px-4 py-3 text-ink-100 placeholder:text-ink-600 focus:border-amber-glow focus:outline-none"
                style={{ fontSize: '16px' }}
              />
              <div className="mt-2 text-xs text-ink-500">
                URL preview:{' '}
                <span className="font-mono text-ink-300">
                  /family/{slug || '…'}
                </span>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl bg-rose-950/40 border border-rose-900/60 px-4 py-3 text-sm text-rose-200"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="w-full min-h-[44px] rounded-xl bg-amber-glow text-ink-950 font-semibold text-sm active:opacity-80 disabled:opacity-40 disabled:active:opacity-40"
            >
              {submitting ? 'Creating…' : 'Create family'}
            </button>
          </form>

          {auth.status === 'signed-out' && (
            <div className="rounded-xl bg-amber-glow/10 border border-amber-glow/30 px-4 py-3 text-sm text-amber-glow">
              Sign in to create a family.
              <button
                type="button"
                onClick={auth.signIn}
                className="ml-3 px-3 py-1 rounded-lg bg-amber-glow text-ink-950 font-semibold text-xs active:opacity-80"
              >
                Sign in
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * Lossy ASCII kebab-case for slugs. Drops anything that isn't
 * [a-z0-9], collapses runs of dashes, trims edge dashes, caps to 64.
 * Accented characters become dashes — acceptable for v1; a future
 * PR can add NFKD-based diacritic stripping if multi-language family
 * names become a real use case. "The Smiths!" -> "the-smiths".
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
