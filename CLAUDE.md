# CLAUDE.md

Context for Claude Code sessions on this repo. Future sessions should read this at the start of every session so they don't have to re-derive the architecture from scratch.

## What this is

Mobile-first PWA Zach uses on his iPhone to track family movie nights. Primary real users: him + his wife (the "Johnson" family). Data: ~60 library movies + a ~400-title recommendation pool, growing slowly. Dark mode only. Designed for one-handed use in dim light on an iPhone (Friday-night couch use case). The app grew from a single-family tracker into a **multi-family** app with Google sign-in, per-family libraries, and a deterministic "For You" recommender — but the Johnsons are still the only active family.

## Stack

- **Vite + React 18 + TypeScript** — SPA. **Path-based routing** lives in `src/router.ts` (hand-rolled, no router library): landing / families directory / `family/:slug` / `family/:slug/m/:title` / settings / onboarding / `auth/callback`. Within a family, the tabs (Watched / Wishlist / For You) and the modals (new movie, candidate preview, Manage pool, weights) are **ephemeral component state in `App.tsx`**, not URLs — so a refresh on a tab or modal drops back to the list.
- **Two UI skins.** `src/components/*` (classic) and `src/components/modern/*` (modern) are both live, switched at runtime by a `localStorage` toggle (`mn_design_v2`), **defaulting to modern**. `App.tsx` forks its render on `design === 'modern'`.
- **Tailwind CSS** — custom `ink-*`, `amber-glow`, and `crimson-*` palette in `tailwind.config.js`
- **Supabase** (`@supabase/supabase-js`) — managed Postgres + realtime + Google OAuth
- **vite-plugin-pwa** (Workbox) — installable PWA with offline cache
- **Anthropic API** — server-side only (`api/enrich`, `api/verify`, `api/recommendations`), owner-gated. Fills studio/awards and expands the recommendation pool.
- **OMDB API** — optional, populates RT/IMDb scores and source URLs when `VITE_OMDB_API_KEY` is set. OMDB has **no** streaming data.
- **Watchmode API** — optional, powers the Detail "Where to watch" section when `VITE_WATCHMODE_API_KEY` is set (`src/watchmode.ts`). Looked up by IMDb ID; returns real per-title deep links. Free tier = 2,500 req/mo; results cache onto the Candidate and refresh when stale (>7d) or written by the old TMDB source.
- **Vercel** — hosting + CI/CD, auto-deploys on push to `main`. Serverless functions live in `api/`.

Node 22. Scripts: `npm run dev`, `npm run build`, `npm run preview`, `npm run typecheck`, `npm run test`.

## Data model (read `src/types.ts` first)

The rendered `Movie` is **not** stored directly. It is produced at render time by `mergeEntry(LibraryEntry, Candidate)` in `src/useMovies.ts`:

- **`LibraryEntry`** — the per-family user overlay (row `kind='library'`). Holds only user-specific data: `id` (stable identity — see below), `title`, `imdbId`, `watched`, `dateWatched`, `notes`, `wishlistOrder`, `favorite`, and per-family `commonSenseAge/Score` overrides.
- **`Candidate`** — the shared, global metadata record (row `kind='pool'`). Holds `title`, `year`, `imdbId`, ratings (`rottenTomatoes`, `imdb`, `rottenTomatoesId`), `studio`, `awards`, `poster`, `directors`, `writers`, `streaming`, plus recommender fields (`downvoted`, `removedReason`, `type`). The pool holds **all** movies — both library titles and pure recommendation candidates.
- **Join:** `findCandidate` matches by `imdbId` first, then case-insensitive `title`. Metadata edits made on a library movie route back to the matching Candidate.

Key invariants (understanding these saves a lot of debugging):

- **`LibraryEntry.id` is the identity**, not `title`. `updateMovie`/`deleteMovie` and React list keys match on `id` so two movies can share a title (remakes) without mis-targeting. Backfilled + persisted on load for older rows. Routing stays title-based for share-link compatibility.
- **`watched: boolean` drives which tab a movie appears on**, not `dateWatched`. `watched: true, dateWatched: null` renders as "Date unknown".
- **`imdbId` doubles as a "linked/verified" flag.** Non-null means matched against OMDB. Surfaced from the Candidate at merge time even when the LibraryEntry's own `imdbId` is null.
- **Dates are parsed manually**, never via `new Date("2024-12-06")` — that shifts the day by the local timezone. Use `formatDate`/`todayIso` in `src/format.ts`. (Full ISO timestamps are fine to pass to `new Date()`; only pure-date strings are dangerous.)

`movies.json` at the repo root is the bundled seed / offline fallback (flat `Movie[]` shape). In local mode (no Supabase env) the app renders it directly.

## Supabase architecture (important: read before touching)

**Multi-row JSONB, multi-family.** One table `movie_night(id int pk, movies jsonb, family_id uuid null, kind text)` where `kind ∈ {library, pool, reasons, weights}`:

- `kind='library'` rows are **per-family** (`family_id` set) — one `LibraryEntry[]` blob each.
- `kind='pool' | 'reasons' | 'weights'` rows are **global** (`family_id IS NULL`) — the shared `Candidate[]` pool, the removal-reason vocabulary, and the `ScoringWeights` object. Shared across every family by design.

Plus two relational tables: `families(id, slug, name, created_by)` and `family_members(id, family_id, user_id, email citext, role ∈ {admin,member}, is_global_owner, ...)`.

Trade-offs of the JSONB-blob approach still hold: zero schema migrations to add a Movie field, `movies.json` mirrors the shape, one write path per blob — but **last-write-wins on the whole array** and no per-field SQL. Bulk refreshers re-read + merge before writing to avoid clobbering concurrent edits (`commitPoolPatches` in `useCandidatePool.ts`).

**Auth & authorization:**

- Google OAuth via Supabase (`src/useAuth.ts`). Membership comes from `family_members`; `create_family` and `claim_pending_memberships` are `SECURITY DEFINER` RPCs (the latter binds an admin-invited row to a `user_id` on first sign-in).
- `is_global_owner` (only Zach) unlocks the credit-spending Anthropic endpoints — the `api/enrich|verify|recommendations` handlers verify it server-side.
- **RLS is membership-scoped** (migration `supabase/migrations/20260703000000_tighten_rls_membership_scoped.sql`), *not* permissive. Public **read** (share/poster/movies endpoints + signed-out landing read the blobs unauthenticated). **Writes** require family membership — family members for `library` rows, any signed-in member for the global rows. `family_members` roster is member-readable and admin-writable; `is_global_owner` is not client-writable (table-level write grant dropped, columns re-granted minus that one). Membership checks go through `is_family_member` / `is_family_admin` / `is_family_member_any` `SECURITY DEFINER` helpers (to avoid RLS recursion). **Do not re-introduce `USING (true)` write policies.**

## Recommendations ("For You")

Deterministic, no LLM on the user path. `rankTopPicks` (`src/recommendations.ts`) scores eligible pool Candidates against the user's library via the pure `scoreCandidate` (`src/scoring.ts`, weighted RT/IMDb/CSM/studio/awards/director-affinity/writer-affinity, weights stored in the `weights` row). Admin pool management lives in `PoolAdmin.tsx`: expand the pool via Claude (`api/recommendations`, streaming), backfill studio/awards (`api/enrich`), fact-check a field (`api/verify`), bulk OMDB / Watchmode refresh, downvote, and soft-remove with a reason vocabulary.

## API (Vercel serverless, `api/`)

- **Public reads:** `movies`, `watched` (Johnson library), `share/[title]` + `share/f/[slug]/[title]` (OG/Twitter unfurl HTML), `poster/[slug]` + `poster/f/[slug]/[title]` (image proxy — **SSRF-guarded**: only fetches `m.media-amazon.com` over https, with a timeout), `version`.
- **Owner-gated (Anthropic):** `enrich`, `verify`, `recommendations` — all check a `family_members` row with `is_global_owner = true`.
- **Bundler gotcha:** the share/poster routes **inline** their helpers instead of importing `api/_lib/share-core.ts` — Vercel's function bundler drops the `_lib` import for those routes (ERR_MODULE_NOT_FOUND). `api/_lib/share-core.ts` is the tested canonical copy; keep the inlined copies in sync.

## File layout

```
src/
├── App.tsx                 # routing glue + tab/modal/skin state, admin gating, data orchestration
├── router.ts               # path-based routes + useRoute hook (history + popstate)
├── types.ts                # Movie / LibraryEntry / Candidate / StreamingInfo (source of truth)
├── format.ts               # date parsing, emptyMovie(), sorts, crossovers, coerceCreatorLists, formatRtScore
├── supabase.ts             # client config + table/kind constants
├── useMovies.ts            # per-family library load/subscribe/write + merge with pool → Movie[]
├── useCandidatePool.ts     # global pool/reasons/weights load/subscribe/write + bulk refreshers
├── useAuth.ts              # Google OAuth + membership; useFamilies.ts / useFamilyMembers.ts
├── recommendations.ts      # rankTopPicks / expandPool; scoring.ts = pure scoreCandidate
├── enrich.ts / verify.ts   # clients for the owner-gated Anthropic endpoints
├── omdb.ts / watchmode.ts  # OMDB + Watchmode REST clients
└── components/             # classic skin (Detail, WatchedList, Wishlist, Recommendations, PoolAdmin, …)
    └── modern/             # modern skin (default) — parallel Detail/WatchedList/Wishlist/Recommendations
api/                        # Vercel serverless (see above); _lib/share-core.ts is the tested core
supabase/migrations/        # SQL migrations (RLS, multi-family schema)
```

## Testing

`npm run test` (Vitest). Logic + api tests run in the `node` environment; component tests opt into a DOM via a `// @vitest-environment happy-dom` docblock (React Testing Library). Tests live next to source: `src/**/*.test.{ts,tsx}` and `api/**/*.test.ts`. High-value pure logic (scoring, merge/migration, recommendations, date/format helpers) is covered; the merge helpers in `useMovies.ts` are exported for testing.

## Deploy pipeline

- GitHub: `zachtjohnson01/movie-night`
- **Branch model: one worktree per task, off `origin/main`, torn down after merge.** Don't share a long-lived dev branch — the user runs multiple parallel `claude` CLI sessions and a shared branch causes them to clobber each other's edits and silently auto-stash work. See rule #2.
- Push → open PR → auto-merge squashes when checks are green → Vercel auto-deploys in ~60s.
- PWA service worker may serve a stale `index.html` on first open after a deploy. Force-quit the PWA to pick up new code.

## Environment variables (set in Vercel dashboard)

| Name | Used by | Required? |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/supabase.ts` | Yes — without it the app runs in local-only mode with a warning banner |
| `VITE_SUPABASE_ANON_KEY` | `src/supabase.ts` | Yes — publishable key (`sb_publishable_*`, not the legacy `eyJ...` anon JWT) |
| `VITE_OMDB_API_KEY` | `src/omdb.ts` | No — OMDB features disable themselves if missing |
| `VITE_WATCHMODE_API_KEY` | `src/watchmode.ts` | No — the "Where to watch" section + Manage-pool refresh disable themselves if missing |
| `ANTHROPIC_API_KEY` | `api/enrich\|verify\|recommendations` | Server-side; required for the owner-only AI tools |

The user manages env vars via the Vercel web dashboard, not via CLI. Don't suggest `vercel env add`.

## Mobile-first conventions (non-negotiable for UI work)

- **44px minimum tap targets** everywhere (Apple HIG).
- **Respect safe-area insets.** Sticky headers use `paddingTop: calc(env(safe-area-inset-top) + 0.75rem)` to clear the notch / Dynamic Island. Bottom tab bar uses `env(safe-area-inset-bottom)`.
- **`font-size: 16px`** on all inputs to prevent iOS Safari's zoom-on-focus.
- **`autoCorrect="off"`** on inputs that aren't free-form prose.
- **No animations that delay interaction.** Subtle transitions only.
- **High contrast, big type.** Dim-light readability matters.
- **Test on an actual iPhone before declaring a UI change done.** Desktop preview does not reveal safe-area, tap-target, or viewport quirks. If you can't test the PWA on a phone, say so explicitly rather than claiming success.

## Color system (from `tailwind.config.js`)

- **Backgrounds**: `ink-950` (page), `ink-900` (cards), `ink-800` (input fields), `ink-700` (borders)
- **Text**: `ink-100` (primary), `ink-300` (secondary), `ink-500` (labels), `ink-600` (disabled)
- **Primary accent**: `amber-glow` (bright warm yellow — primary actions, linked badges, "+" button)
- **Crimson accents**: `crimson-deep` / `crimson-bright` (mark-as-watched button, "FAMILY MOVIE NIGHT" label)
- **CSM age pills** (via `ageBadgeClass` in `format.ts`): emerald ≤4+, amber ≤6+, orange ≤8+, rose 9+

## Known quirks and gotchas

- **PWA cache staleness**: after a prod deploy the service worker serves the cached `index.html` on first open, then updates in the background. Force-quit to see new code immediately. Not a bug — `registerType: 'autoUpdate'` handles it on the *next* open.
- **`createClient` config `realtime: { params: { eventsPerSecond: 5 } }`** throttles realtime events. Knob to turn if debugging sync.
- **"OMDB ID" is the IMDb ID.** OMDB doesn't mint its own IDs; the `imdbID` field is literally `tt0096283`.
- **Dates like `"2024-12-06"` must not be passed to `new Date()`** — shifts the day in negative timezones. Use the helpers in `format.ts`.
- **Two `normalizeTitle` implementations exist** and differ: `src/omdb.ts` (strips apostrophes / punctuation → spaces, used for pool dedup) vs `api/_lib/share-core.ts` (NFC + whitespace collapse, used for share/poster lookup). Each is self-consistent within its own subsystem; don't assume they match.

## Working on this repo — conventions

1. **Read `src/types.ts` first** if making any data-shape change. Everything follows from the `Movie`/`LibraryEntry`/`Candidate` split.
2. **Use a worktree per task — this is the canonical loop.** Call `EnterWorktree({name: "<feature>"})` first for any non-trivial change, then `git fetch origin && git reset --hard origin/main` inside it. A plain `git checkout -b ...` runs in the shared working tree, where sibling Claude sessions will switch your branch and auto-stash your edits without warning. After merge, `ExitWorktree({action: "remove"})`. Skip only for read-only investigation, a single trivial edit, or pure docs. See `feedback_standard_workflow.md`, `feedback_use_worktree.md`, `parallel_claude_sessions.md`.
3. **Don't create files unless necessary** — prefer editing existing files. Keep the tree small.
4. **Don't add emojis to source files** unless the user explicitly asks.
5. **Run `npm run build` before every commit.** The stop hook enforces commit+push, but doesn't check build health. A broken build = broken deploy.
6. **PR titles < 70 chars.** Details go in the body.
7. **The user is on an iPhone almost always.** Any instructions must work from mobile Safari + GitHub mobile + the Vercel/Supabase web dashboards. Never suggest CLI tools they'd install on a laptop.
8. **The Vercel & Supabase MCP servers are available.** Read ops (list deploys/logs, list tables, advisors) work headless; Supabase write access depends on the `read_only` flag in `.mcp.json` (`reference_supabase_mcp.md`). Env var mutation + deploy creation still happen in the web dashboards.
9. **If debugging share-link previews / iMessage unfurls, read `docs/debugging-share-previews.md` first.** Diagnostic endpoints (`/api/version`, `/share/<title>?debug=1`, `?debug=html`, `/api/poster/<title>?debug=1`), Apple `LPMetadataProvider` quirks, and Vercel bundling gotchas are all there.
10. **After every `gh pr create`, immediately enable auto-merge:** `gh pr merge <num> --auto --squash`. The `main` ruleset requires the Vercel check, so auto-merge waits for green and squashes. If main moves and the PR goes `BEHIND`, rebase + force-push without asking (`feedback_pr_behind_rebase.md`). Then watch until merged (`feedback_watch_pr_until_done.md`); auto-merge won't fire on a red PR.
