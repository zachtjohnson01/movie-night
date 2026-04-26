import { useMemo, useState } from 'react';

type Props = {
  existingEmails: string[];
  onAdd: (email: string) => Promise<void>;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function AddMemberForm({ existingEmails, onAdd }: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = email.trim().toLowerCase();
  const isValid = trimmed.length > 0 && EMAIL_RE.test(trimmed);
  const existingSet = useMemo(
    () => new Set(existingEmails.map((e) => e.toLowerCase())),
    [existingEmails],
  );
  const isDuplicate = isValid && existingSet.has(trimmed);
  const canSubmit = isValid && !isDuplicate && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(trimmed);
      setEmail('');
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Failed to invite member';
      setError(
        /duplicate|unique/i.test(msg) ? 'That email is already invited.' : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-ink-500 font-semibold mb-1">
        Invite member
      </div>
      <div className="flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className="flex-1 h-12 rounded-2xl bg-ink-800 border border-ink-700 px-4 text-base placeholder:text-ink-500 focus:outline-none focus:border-amber-glow/60"
          style={{ fontSize: '16px' }}
          aria-label="Invite by email"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="shrink-0 px-5 min-h-[48px] rounded-2xl font-bold text-sm bg-amber-glow text-ink-950 active:opacity-80 disabled:bg-ink-800 disabled:text-ink-500 disabled:border disabled:border-ink-700"
        >
          Invite
        </button>
      </div>
      {isDuplicate && (
        <div className="text-[11px] text-amber-glow/90">
          Already invited.
        </div>
      )}
      {error && (
        <div className="text-[11px] text-rose-300" role="alert">
          {error}
        </div>
      )}
      <p className="text-[11px] text-ink-500 leading-relaxed">
        Invites bind the first time that email signs in with Google.
      </p>
    </form>
  );
}
