import { useMemo, useState } from 'react';
import type { UserRole, UserRoleEntry, UserRolesApi } from '../useUserRoles';

type Props = {
  api: UserRolesApi;
  currentEmail: string | null;
  onBack: () => void;
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  editor: 'Editor',
};

const ROLE_DESCRIPTION: Record<UserRole, string> = {
  admin: 'Full access — manage pool, weights, and users',
  editor: 'Add, edit, delete movies; mark watched',
};

export default function UsersAdmin({ api, currentEmail, onBack }: Props) {
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('editor');
  const [pending, setPending] = useState<string | null>(null);

  const me = currentEmail?.toLowerCase() ?? null;

  // Sort: admins first, then editors, alphabetical within each.
  const sorted = useMemo(() => {
    const order: UserRole[] = ['admin', 'editor'];
    return [...api.roles].sort((a, b) => {
      const oa = order.indexOf(a.role);
      const ob = order.indexOf(b.role);
      if (oa !== ob) return oa - ob;
      return a.email.localeCompare(b.email);
    });
  }, [api.roles]);

  const adminCount = useMemo(
    () => api.roles.filter((r) => r.role === 'admin').length,
    [api.roles],
  );

  // The current admin can always demote/remove other admins, but never the
  // last admin — that would lock everyone out of the role-management UI.
  // Demoting yourself is allowed only if at least one other admin remains.
  function isLastAdmin(entry: UserRoleEntry): boolean {
    return entry.role === 'admin' && adminCount <= 1;
  }

  async function handleChangeRole(entry: UserRoleEntry, role: UserRole) {
    if (entry.role === role) return;
    if (entry.role === 'admin' && role !== 'admin' && isLastAdmin(entry)) {
      return;
    }
    setPending(entry.email);
    try {
      await api.upsertRole(entry.email, role);
    } finally {
      setPending(null);
    }
  }

  async function handleRemove(entry: UserRoleEntry) {
    if (isLastAdmin(entry)) return;
    setPending(entry.email);
    try {
      await api.removeRole(entry.email);
    } finally {
      setPending(null);
    }
  }

  async function handleAdd() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setPending(email);
    try {
      await api.upsertRole(email, newRole);
      setNewEmail('');
      setNewRole('editor');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl pb-8">
      <header
        className="sticky top-0 z-20 px-5 pb-3 bg-ink-950/92 backdrop-blur-lg border-b border-ink-800/60"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
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
            <div className="text-[10px] uppercase tracking-[0.22em] text-crimson-bright font-semibold">
              Admin
            </div>
            <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight">
              Users &amp; roles
            </h1>
            <div className="mt-1 text-[11px] text-ink-500 tabular-nums">
              <span className="text-ink-300 font-semibold">
                {api.roles.length}
              </span>{' '}
              total ·{' '}
              <span className="text-ink-300 font-semibold">{adminCount}</span>{' '}
              admin
            </div>
          </div>
        </div>
      </header>

      <section className="px-5 pt-4 pb-2">
        <div className="text-[10px] uppercase tracking-[0.2em] text-ink-500 font-semibold mb-2">
          Add user
        </div>
        <div className="flex flex-col gap-2">
          <input
            type="email"
            inputMode="email"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="email@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="w-full h-12 rounded-2xl bg-ink-800 border border-ink-700 px-4 text-base placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
          />
          <div className="flex gap-2">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="flex-1 h-12 rounded-2xl bg-ink-800 border border-ink-700 px-3 text-base text-ink-100 focus:outline-none focus:border-amber-glow/60"
            >
              <option value="editor">{ROLE_LABEL.editor}</option>
              <option value="admin">{ROLE_LABEL.admin}</option>
            </select>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={
                pending !== null ||
                !newEmail.trim() ||
                !newEmail.includes('@')
              }
              className="shrink-0 px-5 min-h-[48px] rounded-2xl font-bold text-sm bg-amber-glow text-ink-950 active:opacity-80 disabled:bg-ink-800 disabled:text-ink-500 disabled:border disabled:border-ink-700"
            >
              Add
            </button>
          </div>
          <p className="text-[11px] text-ink-500 leading-relaxed">
            Editors can add &amp; edit movies. Admins also manage the
            candidate pool, scoring weights, and users.
          </p>
        </div>
      </section>

      <ul className="mt-2">
        {sorted.map((entry) => {
          const isMe = entry.email === me;
          const lastAdmin = isLastAdmin(entry);
          const busy = pending === entry.email;
          return (
            <li
              key={entry.email}
              className="border-t border-ink-800/70 px-5 py-3.5 flex flex-col gap-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[15px] font-semibold text-ink-100 truncate">
                  {entry.email}
                  {isMe && (
                    <span className="ml-2 text-[10px] font-mono text-ink-500 uppercase tracking-wider">
                      you
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-ink-500 leading-snug">
                {ROLE_DESCRIPTION[entry.role]}
              </div>
              <div className="flex gap-2 items-center">
                <select
                  value={entry.role}
                  onChange={(e) =>
                    void handleChangeRole(entry, e.target.value as UserRole)
                  }
                  disabled={busy || lastAdmin}
                  className="flex-1 h-10 rounded-xl bg-ink-800 border border-ink-700 px-3 text-sm text-ink-100 focus:outline-none focus:border-amber-glow/60 disabled:opacity-60"
                  aria-label={`Role for ${entry.email}`}
                >
                  <option value="editor">{ROLE_LABEL.editor}</option>
                  <option value="admin">{ROLE_LABEL.admin}</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleRemove(entry)}
                  disabled={busy || lastAdmin}
                  className="shrink-0 h-10 px-3 rounded-xl bg-ink-800 border border-ink-700 text-xs font-semibold text-crimson-bright active:bg-ink-700 disabled:opacity-50 disabled:text-ink-500"
                >
                  Remove
                </button>
              </div>
              {lastAdmin && (
                <div className="text-[11px] text-ink-500 italic">
                  Can&apos;t remove the last admin — promote someone else
                  first.
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {sorted.length === 0 && (
        <div className="px-6 pt-10 text-center text-ink-400 text-sm">
          No users yet.
        </div>
      )}
    </div>
  );
}
