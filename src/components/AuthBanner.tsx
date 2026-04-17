import type { AuthStatus } from '../useAuth';

type Props = {
  status: AuthStatus;
  email: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
};

/**
 * Thin banner shown when the user isn't signed in or is signed in with an
 * email that isn't on the allowlist. Hidden on the happy path (signed-in
 * allowlisted user).
 */
export default function AuthBanner({
  status,
  email,
  onSignIn,
  onSignOut,
}: Props) {
  if (status === 'loading' || status === 'signed-in') return null;

  if (status === 'signed-out') {
    return (
      <div
        className="safe-top px-5 pt-2 pb-2 flex items-center justify-center gap-3 text-[11px] text-amber-glow/90 bg-amber-glow/10 border-b border-amber-glow/20"
        role="status"
      >
        <span>Sign in to add or edit movies.</span>
        <button
          type="button"
          onClick={onSignIn}
          className="px-3 py-1 rounded-lg bg-amber-glow text-ink-950 font-semibold text-xs active:opacity-80"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div
      className="safe-top px-5 pt-2 pb-2 flex items-center justify-center gap-3 text-[11px] text-amber-glow/90 bg-amber-glow/10 border-b border-amber-glow/20"
      role="status"
    >
      <span className="truncate">
        Signed in as {email} — read-only.
      </span>
      <button
        type="button"
        onClick={onSignOut}
        className="px-3 py-1 rounded-lg bg-ink-800 border border-ink-700 text-ink-200 font-semibold text-xs active:bg-ink-700"
      >
        Sign out
      </button>
    </div>
  );
}
