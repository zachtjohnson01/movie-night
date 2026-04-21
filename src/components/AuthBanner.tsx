import type { AuthStatus } from '../useAuth';

type Props = {
  status: AuthStatus;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
};

/**
 * Banner / user strip at the top of the app.
 * - signed-in (allowlisted): compact user card with avatar, name, email,
 *   and a Sign out button. Always visible on list views so the sign-out
 *   affordance isn't hidden.
 * - signed-out: amber strip prompting Google sign-in.
 * - unauthorized: amber strip with email + Sign out.
 * - loading: null (brief).
 */
export default function AuthBanner({
  status,
  email,
  name,
  avatarUrl,
  onSignIn,
  onSignOut,
}: Props) {
  if (status === 'loading') return null;

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

  if (status === 'unauthorized') {
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

  // signed-in (allowlisted)
  const initial = (name ?? email ?? '?').slice(0, 1).toUpperCase();
  return (
    <div
      className="safe-top px-4 pt-2 pb-2 flex items-center gap-3 bg-ink-900 border-b border-ink-800/60"
      role="banner"
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          // Google's lh3.googleusercontent.com URLs 403 from some referer
          // contexts (observed in installed PWAs). Stripping the referer
          // header avoids it without losing the image.
          referrerPolicy="no-referrer"
          className="w-9 h-9 rounded-full border border-ink-700 object-cover"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center text-ink-300 text-xs font-bold">
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-sm font-semibold text-ink-100 truncate">
          {name ?? email}
        </div>
        {name && email && (
          <div className="text-[11px] text-ink-400 truncate">{email}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="shrink-0 min-h-[36px] px-3 rounded-lg bg-ink-800 border border-ink-700 text-ink-200 text-xs font-semibold active:bg-ink-700"
      >
        Sign out
      </button>
    </div>
  );
}
