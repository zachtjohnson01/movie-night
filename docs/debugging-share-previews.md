# Debugging share previews

Hard-won lessons from the multi-PR session that finally got iMessage to render movie posters in `/share/<title>` link previews. If a future Claude session is staring at a generic preview card, **read this first** before iterating.

## Recommended MCPs (read first, in this order)

If `~/.claude/mcp.json` has these configured, use them — they will save hours over the screenshot-and-guess loop:

1. **Vercel MCP** — `vercel logs --since=5m /api/share/Bolt` shows function runtime errors directly. Would have surfaced `ERR_MODULE_NOT_FOUND` immediately instead of needing a custom debug endpoint.
2. **Supabase MCP** — query `movie_night` row 1 (LibraryEntry) and row 2 (Candidate) directly to verify title casing, imdbId joins, poster URL shape.
3. **Fetch MCP** (allowlisted to `familymovienight.watch`) — hit deployed URLs from the sandbox without asking the user to load them in Safari.

If those MCPs are not present, **suggest installing them in `~/.claude/mcp.json`** before going down the screenshot-loop rabbit hole.

## Diagnostic endpoints already built

These exist in production. Use them before adding new logging.

| URL | Purpose |
|---|---|
| `/api/version` | Zero-deps. Returns `{commitSha, commitShaShort, deployId, env, region, serverTime}`. **Always hit this first** to confirm which commit is actually serving requests. |
| `/share/<title>?debug=1` | JSON dump of the share-unfurl lookup state: `entryCount`, `candidateCount`, `entryMatch`, `candidateMatch`, `resolved` movie payload. |
| `/share/<title>?debug=html` | Returns the rendered HTML as `text/plain` so you can inspect the injected og/twitter tags from any browser (iOS Safari has no view-source). |
| `/api/poster/<title>?debug=1` | JSON dump of the poster proxy lookup. |
| `/api/poster/<title>.jpg` | Direct image. Loads in Safari → proxy works. |

`x-commit` header is set on `/api/poster/*` responses for quick "is this the latest" checks via `curl -I`.

## Apple `LPMetadataProvider` gotchas (documented or learned the hard way)

These are the real, recurring causes of preview failures. Check each before assuming our code is wrong.

- **og:image must be ≥ 600x315.** OMDB returns `_SX300` posters (300px wide). Apple silently rejects images below the threshold and falls back to `apple-touch-icon` / Safari placeholder. We rewrite the Amazon URL `_SX300 → _SX600` in `api/poster/[slug].ts`.
- **Apple has a per-URL "image is broken" cache** that survives across re-fetches and ignores the parent page URL changing. We cache-bust both the share URL **and** the og:image URL with `?v=<commit-sha>` so each deploy emits URLs Apple has never seen.
- **Apple may probe `/apple-touch-icon.png` by URL convention even without a `<link rel>` tag** for it. We strip both the og/twitter meta tags and the apple-touch-icon link from the response template in `buildShareHtml`.
- **Static og tags in `index.html` "win" over dynamically-injected ones** for some unfurlers (Apple takes "first wins" on duplicate `og:image`). The template strip is mandatory; appending duplicates doesn't work.
- **iMessage uses Safari/WebKit under the hood.** `Settings → Safari → Clear History and Website Data` clears link previews too. Restarting the iPhone clears in-memory `LPMetadataProvider` cache.
- **`@` in the og:image URL** appears to be parsed strictly — Amazon poster paths contain it as a content-hash delimiter. Routing through `/api/poster/<title>.jpg` gives Apple a clean URL.

## Vercel quirks (these bit us)

- **Files in `api/_lib/` are not bundled into a function's deploy when imported via dynamic `await import(...)`.** Vercel's tracer only follows static top-of-file imports. If you must use a dynamic import, copy the helper into the function instead, or static-import it.
- **A file at `api/foo.ts` AND a folder at `api/foo/[slug].ts` can collide** in the filesystem router and cause `FUNCTION_INVOCATION_FAILED`. Pick one shape.
- **`s-maxage` + `stale-while-revalidate=86400`** means a one-time bad response can stick at the edge for 24 hours. For diagnostic-iteration phases, use `Cache-Control: no-store`.
- **Env vars set on Vercel must be enabled for the right environment** (Production / Preview / Development). Server functions read `process.env.VITE_*` fine — it's a naming convention, not a Vite-only thing.

## Diagnostic workflow when previews break

1. **`GET /api/version`** — confirm the commit you think is deployed is actually serving.
2. **`GET /share/<title>?debug=1`** — confirm the function resolves the movie. `entryMatch` should be `exact` for library movies. If `none`, the title casing in Supabase doesn't match what the SPA shared.
3. **`GET /share/<title>?debug=html`** — confirm the injected og tags are correct. Exactly one `og:image`, pointing at `/api/poster/<title>.jpg?v=<commit>`. No `apple-touch-icon` link present.
4. **`GET /api/poster/<title>.jpg`** — confirm the proxy returns image bytes. Open in Safari (private tab to bypass SW). If the poster renders, the function works end-to-end.
5. **Share to a fresh iMessage thread** with a movie that has never been shared. If preview is still wrong, the problem is on Apple's side (cache or unsupported attribute), not in our code.
6. **Phone-side cache reset** if all of the above are correct: Settings → Safari → Clear History and Website Data → restart phone → delete prior bubbles → retry.

## What "the preview is correct" looks like

| Element | Source | Value |
|---|---|---|
| Title in card | `og:title` | `Bolt (2008)` |
| Subtitle | URL hostname | `familymovienight.watch` |
| Description | `og:description` | `RT 90% — IMDb 6.8 — 5+` |
| Image | `og:image` → `/api/poster/Bolt.jpg?v=<commit>` | The actual poster |

If title is right but image is the Safari compass: **og:image fetch failed**. Check size (≥600px wide), cache-buster, and try `/api/poster/<title>.jpg` directly in Safari.

If title is "Family Movie Night" instead of the movie name: **the function isn't running**. Either the rewrite isn't firing or the function is crashing at module load. Check `/api/version`, then `vercel logs`.

## Schema split — important context

`useMovies.ts` joins two Supabase rows to build a Movie:

- **Row id=1** (`movie_night.movies`) → `LibraryEntry[]` — user-overlay only (`title`, `imdbId`, `displayTitle`, `commonSenseAge`, `commonSenseScore`, `watched`, `dateWatched`, `notes`, `wishlistOrder`).
- **Row id=2** → `Candidate[]` — OMDB enrichment (`poster`, `year`, `rottenTomatoes`, `imdb`, `awards`, `directors`, `writers`, etc.).

`api/_lib/share-core.ts` `lookupMovie` mirrors the join: prefer `imdbId` match, fall back to case-insensitive title. The poster handler inlines an equivalent (smaller) version because Vercel wouldn't bundle the shared lib for that route.

Any new server endpoint that needs to render a movie must perform this join, not just read row 1.
