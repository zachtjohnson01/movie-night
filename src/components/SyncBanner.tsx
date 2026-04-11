import type { SyncStatus } from '../useMovies';

type Props = { status: SyncStatus };

/**
 * Small banner that appears only when the app isn't syncing to Supabase.
 * - 'local'   → env vars not set; edits won't persist anywhere
 * - 'error'   → Supabase is configured but calls are failing
 * - 'loading' → first fetch in progress (brief, no banner needed)
 * - 'synced'  → happy path (no banner)
 */
export default function SyncBanner({ status }: Props) {
  if (status === 'synced' || status === 'loading') return null;

  const message =
    status === 'local'
      ? "Not connected to Supabase — edits won't save. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel."
      : 'Sync error — changes may not have saved. Check your connection.';

  return (
    <div
      className="safe-top px-5 pt-2 pb-1 text-center text-[11px] text-amber-glow/90 bg-amber-glow/10 border-b border-amber-glow/20"
      role="status"
    >
      {message}
    </div>
  );
}
