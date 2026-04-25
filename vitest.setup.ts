// Default Supabase env so module-level reads in api/_lib/share-core.ts and
// api/poster/[slug].ts resolve to truthy values during test runs. Individual
// tests can override via `vi.stubEnv` + `vi.resetModules()` + dynamic import
// when they need to exercise the missing-env code path.
process.env.VITE_SUPABASE_URL ??= 'http://localhost:54321';
process.env.VITE_SUPABASE_ANON_KEY ??= 'sb_publishable_test';
process.env.VERCEL_GIT_COMMIT_SHA ??= 'abcdef0123456789';
