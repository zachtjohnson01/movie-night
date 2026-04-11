import { formatRelativeTime } from '../format';

/**
 * Tiny always-visible build stamp. Used for diagnosing PWA service
 * worker staleness: if the user looks at the app and sees an old
 * commit SHA or "X hours ago" timestamp, their PWA is still running
 * an old bundle and they need to reinstall / force an SW update.
 *
 * Values are injected at build time via `define` in vite.config.ts.
 * `__BUILD_COMMIT__` comes from `VERCEL_GIT_COMMIT_SHA` in CI, or
 * `git rev-parse HEAD` for local builds.
 */
export default function BuildStamp() {
  return (
    <div
      className="text-center text-[9px] text-ink-600 font-mono tabular-nums leading-tight"
      aria-hidden
    >
      build {__BUILD_COMMIT__} · {formatRelativeTime(__BUILD_TIME__)}
    </div>
  );
}
