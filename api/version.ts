import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Zero-dependency health/version endpoint. Because it has no imports
 * beyond the @vercel/node types, it cannot fail at module-load time.
 * Lets us verify which deploy is live independent of whether the
 * heavier functions (e.g. /api/poster/<title>.jpg) are crashing.
 *
 * Returns JSON with the Vercel-provided build identifiers plus the
 * current server time. Cache-disabled so every hit reflects the
 * currently-serving function bundle.
 */
export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('access-control-allow-origin', '*');
  // Deliberately minimal: the commit SHA is enough to identify the live
  // deploy. The commit message, branch ref, and internal deploy id were
  // dropped — no reason to expose them on a public, unauthenticated endpoint.
  return res.status(200).json({
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    commitShaShort: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    env: process.env.VERCEL_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
    serverTime: new Date().toISOString(),
  });
}
