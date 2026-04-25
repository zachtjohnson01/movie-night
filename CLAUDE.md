# CLAUDE.md

Context for Claude Code sessions on this repo. Future sessions should read this at the start of every session so they don't have to re-derive the architecture from scratch.

## What this is

Mobile-first PWA Zach uses on his iPhone to track the family movie nights he watches with his daughter and wife. Real users: him + his wife. Data: ~40 movies, growing slowly. Dark mode only. Designed for one-handed use in dim light on an iPhone (Friday night couch use case).

## Stack

- **Vite + React 18 + TypeScript** — SPA, no router. View switching is driven by state in `App.tsx` (no URL changes).
- **Tailwind CSS** — custom `ink-*`, `amber-glow`, and `crimson-*` palette in `tailwind.config.js`
- **Supabase** (`@supabase/supabase-js`) — managed Postgres + realtime for multi-user sync
- **vite-plugin-pwa** (Workbox) — installable PWA with offline cache
- **OMDB API** — optional, populates RT/IMDb scores and source URLs when `VITE_OMDB_API_KEY` is set
- **Vercel** — hosting + CI/CD, auto-deploys on push to `main`

Node 22. Scripts: `npm run dev`, `npm run build`, `npm run preview`, `npm run typecheck`.

## Data model

Single source of truth: `src/types.ts` → `Movie` type. The bundled `movies.json` at the repo root matches the same shape and is both the seed data and the offline fallback.

Key invariants (understanding these saves a lot of debugging):

- **`watched: boolean` drives which tab a movie appears on**, not `dateWatched`. A movie can be `watched: true, dateWatched: null` — that renders as "Date unknown" on the Watched tab.
- **`imdbId` doubles as a "linked/verified" flag.** Non-null means the movie was matched against OMDB and has canonical external IDs. Null means manual entry.
- **Dates are parsed manually**, never via `new Date(isoString)`. That API shifts pure-date strings ("2024-12-06") by the local timezone, which corrupts data. See `formatDate` and `todayIso` in `src/format.ts`.

## Supabase architecture (important: read before touching)

**Single-row JSONB blob.** One table `movie_night` with exactly two columns: `id int primary key` and `movies jsonb`. Row `id=1` holds the entire array of movies as one JSON value. Every Movie field is a property inside that JSON; Postgres does not see individual columns.

This is deliberate. Trade-offs:

- ✅ Zero schema migrations — adding a field = edit `types.ts` and `movies.json`, no SQL.
- ✅ `movies.json` in git = the exact shape of what's in Supabase. Diffable, backupable, reseedable.
- ✅ One write path: every save replaces the entire array.
- ❌ Last-write-wins on the whole array. Fine for 2 users editing seconds apart; would be wrong at scale.
- ❌ No per-field SQL queries. If you need "count of movies watched in 2025," fetch the blob and count in JS.

The sync flow lives in `src/useMovies.ts`:
1. On mount, fetch the single row from `movie_night` via `@supabase/supabase-js`.
2. If `movies` is `[]`, seed it with the bundled `movies.json` (via `.upsert` — needs the `"anyone can insert"` RLS policy).
3. Subscribe to `postgres_changes` UPDATE events on that row. When the other user writes, their new array arrives via the realtime channel and replaces local state.
4. `updateMovie`/`addMovie`/`deleteMovie` write the whole updated array back via `.update().eq('id', 1)`.

RLS is fully permissive (`using (true)`) on SELECT, UPDATE, and INSERT. Security is URL obscurity only. Fine for a family tracker, not fine if you make it public.

## File layout

```
src/
├── App.tsx                       # top-level state: tab, selected movie, new-movie flow
├── main.tsx, index.css           # entrypoint + Tailwind base + global styles
├── types.ts                      # Movie type (single source of truth)
├── format.ts                     # date parsing, emptyMovie(), sortWatched, ageBadgeClass
├── supabase.ts                   # Supabase client config + table/row constants
├── useMovies.ts                  # load/subscribe/write hook (returns movies + CRUD fns)
├── omdb.ts                       # OMDB REST client + imdbUrl/rottenTomatoesUrl/commonSenseUrl
├── vite-env.d.ts                 # ImportMetaEnv types for VITE_* env vars
└── components/
    ├── WatchedList.tsx           # Watched tab: sticky header, sorted dated→undated
    ├── Wishlist.tsx               # Wishlist tab: alphabetical + substring search
    ├── Detail.tsx                # view/edit/new modes for a single movie
    ├── MovieSearchCombobox.tsx   # debounced OMDB search, poster thumbnails, graceful degradation
    ├── TabBar.tsx                # sticky bottom tab bar (Watched / Wishlist)
    └── SyncBanner.tsx            # shows if Supabase isn't configured or is erroring
```

## Deploy pipeline

- GitHub: `zachtjohnson01/movie-night`
- **Branch model: one worktree per task, off `origin/main`, torn down after merge.** Don't share a long-lived dev branch — the user runs multiple parallel `claude` CLI sessions and a shared branch causes them to clobber each other's edits and silently auto-stash work. See rule #2 below for the canonical loop.
- Push → open PR → auto-merge squashes when checks are green → Vercel auto-deploys in ~60s
- PWA service worker may serve a stale `index.html` on first open after a deploy. Force-quit the PWA to pick up new code.

## Environment variables (set in Vercel dashboard)

| Name | Used by | Required? |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/supabase.ts` | Yes — without it the app runs in local-only mode with a warning banner |
| `VITE_SUPABASE_ANON_KEY` | `src/supabase.ts` | Yes — publishable key (new `sb_publishable_*` format, not the legacy `eyJ...` anon JWT) |
| `VITE_OMDB_API_KEY` | `src/omdb.ts` | No — features that need OMDB disable themselves if missing |

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
- **Primary accent**: `amber-glow` (bright warm yellow — used for primary actions, linked badges, "+" button)
- **Crimson accents**: `crimson-deep` / `crimson-bright` (mark-as-watched button, "FAMILY MOVIE NIGHT" label)
- **CSM age pills** (via `ageBadgeClass` in `format.ts`): emerald ≤4+, amber ≤6+, orange ≤8+, rose 9+

## Known quirks and gotchas

- **Supabase upsert requires INSERT permission**, even when the row already exists. `.upsert()` compiles to `INSERT ... ON CONFLICT DO UPDATE` and Postgres checks INSERT policies regardless of whether the row actually gets inserted. Either use `.update()` (only needs UPDATE policy) or grant an INSERT policy. Current code uses upsert + an INSERT policy so the seed path is self-healing.
- **PWA cache staleness**: after a prod deploy, the service worker serves the cached `index.html` on first open, then updates in the background. Force-quit to see new code immediately. Not a bug — `registerType: 'autoUpdate'` handles it on the *next* open.
- **`createClient` config `realtime: { params: { eventsPerSecond: 5 } }`** throttles realtime events. Knob to turn if debugging sync.
- **"OMDB ID" is the IMDb ID.** OMDB doesn't mint its own IDs; the `imdbID` field in their response is literally `tt0096283`. We store it as `imdbId` and use it both for OMDB lookups and IMDb deep links.
- **Dates like `"2024-12-06"` must not be passed to `new Date()`.** That constructor interprets the string as UTC midnight, which shifts the day in negative timezones. Use the manual parsing helpers in `format.ts`.

## Working on this repo — conventions

1. **Read `src/types.ts` first** if making any data-shape change. Everything else follows from it.
2. **Use a worktree per task — this is the canonical loop.** Call `EnterWorktree({name: "<feature>"})` as the first action for any non-trivial change, then `git fetch origin && git reset --hard origin/main` inside it. A plain `git checkout -b ...` runs in the shared working tree, where sibling Claude sessions will switch your branch and auto-stash your edits without warning. After merge, `ExitWorktree({action: "remove"})` to tear down. Skip only for read-only investigation, a single trivial edit, or pure docs in `.claude/`. Memory entries `feedback_standard_workflow.md`, `feedback_use_worktree.md`, and `parallel_claude_sessions.md` have the full rationale and recovery steps if edits seem to vanish.
3. **Don't create files unless necessary** — prefer editing existing files. Keep the tree small.
4. **Don't add emojis to source files** unless the user explicitly asks.
5. **Run `npm run build` before every commit.** The stop hook enforces commit+push, but doesn't check build health. A broken build = broken deploy.
6. **PR titles < 70 chars.** Details go in the body.
7. **The user is on an iPhone almost always.** Any instructions you give them must work from mobile Safari + GitHub mobile + the Vercel/Supabase web dashboards. Never suggest CLI tools they'd have to install on a laptop.
8. **The Vercel Coding Agent Plugin is installed.** New sessions have access to Vercel MCP tools for read operations (list projects/deploys, view logs, browse docs). Env var mutation and deploy creation still need to happen in the web dashboard.
9. **If debugging share-link previews / iMessage unfurls, read `docs/debugging-share-previews.md` first.** Diagnostic endpoints (`/api/version`, `/share/<title>?debug=1`, `/share/<title>?debug=html`, `/api/poster/<title>?debug=1`), Apple `LPMetadataProvider` quirks, Vercel bundling gotchas, and the recommended diagnostic workflow are all documented there. Use the doc to skip several PR cycles of guess-and-check.
10. **After every `gh pr create`, immediately enable auto-merge:** `gh pr merge <num> --auto --squash`. The repo has a ruleset on `main` that requires the Vercel check, so auto-merge will wait for green and squash. If main moves while your checks are running and the PR goes `BEHIND`, rebase + force-push without asking — see `feedback_pr_behind_rebase.md`. Then poll until merged via `Monitor` (see `feedback_watch_pr_until_done.md`); auto-merge won't fire on a red PR.
