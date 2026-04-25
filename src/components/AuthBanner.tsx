import { useEffect, useRef, useState } from 'react';
import type { AuthStatus } from '../useAuth';

type Props = {
  status: AuthStatus;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  isOwner: boolean;
  viewAsNonOwner: boolean;
  onToggleViewAsNonOwner: () => void;
  design: 'classic' | 'modern';
  onToggleDesign: () => void;
  canManagePool: boolean;
  onOpenPool: () => void;
};

/**
 * Banner / user strip at the top of the app.
 * - signed-in (allowlisted): compact user card with avatar, name, email,
 *   and a hamburger menu (Sign out, View as non-owner for the owner,
 *   Switch classic/modern).
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
  isOwner,
  viewAsNonOwner,
  onToggleViewAsNonOwner,
  design,
  onToggleDesign,
  canManagePool,
  onOpenPool,
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
  return (
    <SignedInBanner
      email={email}
      name={name}
      avatarUrl={avatarUrl}
      onSignOut={onSignOut}
      isOwner={isOwner}
      viewAsNonOwner={viewAsNonOwner}
      onToggleViewAsNonOwner={onToggleViewAsNonOwner}
      design={design}
      onToggleDesign={onToggleDesign}
      canManagePool={canManagePool}
      onOpenPool={onOpenPool}
    />
  );
}

type SignedInProps = Omit<Props, 'status' | 'onSignIn'>;

function SignedInBanner({
  email,
  name,
  avatarUrl,
  onSignOut,
  isOwner,
  viewAsNonOwner,
  onToggleViewAsNonOwner,
  design,
  onToggleDesign,
  canManagePool,
  onOpenPool,
}: SignedInProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointer(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const initial = (name ?? email ?? '?').slice(0, 1).toUpperCase();
  const isModern = design === 'modern';

  function runAndClose(fn: () => void) {
    fn();
    setMenuOpen(false);
  }

  return (
    <div
      className="safe-top px-4 pt-2 pb-2 flex items-center gap-3 bg-ink-900 border-b border-ink-800/60 relative"
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
        ref={buttonRef}
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="shrink-0 min-h-[44px] min-w-[44px] rounded-lg bg-ink-800 border border-ink-700 text-ink-200 flex items-center justify-center active:bg-ink-700"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="w-5 h-5"
          aria-hidden
        >
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-3 top-full mt-1 z-50 w-60 rounded-xl bg-ink-900 border border-ink-700 shadow-xl shadow-black/40 p-1"
        >
          {canManagePool && (
            <MenuItem onClick={() => runAndClose(onOpenPool)}>
              <div>Manage pool</div>
              <div className="text-[11px] text-ink-500 font-normal">
                Browse, expand, edit candidates
              </div>
            </MenuItem>
          )}
          {isOwner && (
            <MenuItem
              onClick={() => runAndClose(onToggleViewAsNonOwner)}
              trailing={
                viewAsNonOwner ? (
                  <CheckIcon />
                ) : (
                  <span className="text-[11px] text-ink-500">off</span>
                )
              }
            >
              <div>View as non-owner</div>
              <div className="text-[11px] text-ink-500 font-normal">
                Hide owner-only tools
              </div>
            </MenuItem>
          )}
          <MenuItem onClick={() => runAndClose(onToggleDesign)}>
            {isModern ? 'Switch to classic UI' : 'Switch to modern UI'}
          </MenuItem>
          <div className="my-1 h-px bg-ink-800" />
          <MenuItem onClick={() => runAndClose(onSignOut)}>
            Sign out
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  trailing,
}: {
  onClick: () => void;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full min-h-[44px] px-3 rounded-lg text-left text-sm font-semibold text-ink-100 flex items-center justify-between gap-3 active:bg-ink-800"
    >
      <span className="flex-1 min-w-0">{children}</span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 text-amber-glow"
      aria-hidden
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
