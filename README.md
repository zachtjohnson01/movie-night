# Friday Movie Night

A tiny, mobile-first PWA that tracks the Friday movie nights I watch with my
daughter. No backend, no accounts, no poster scraping — just a single
`movies.json` file committed to this repo and a dark-themed interface I can
use one-handed from my iPhone.

## What's in the app

- **Watched** tab — count header, date-descending list (known dates first,
  undated watched movies sorted alphabetically below), one score chip per
  row (RT %, falling back to IMDb). Tap `+` to add a movie you already saw.
- **Wishlist** tab — alphabetical, title substring search, Common Sense Media
  age pill + inline RT/IMDb numbers. Tap `+` to add a new title.
- **Detail** screen — all ratings, notes textarea for watched movies, and a
  big "Mark as watched tonight" button. A secondary "Mark watched · date
  unknown" option for movies you saw but don't remember when. Edit mode lets
  you change any field including the date, the watched status, or delete.
- **Multi-user realtime sync** — powered by a single-row Supabase table.
  Both phones subscribe to `postgres_changes`, so when one person marks a
  movie watched, the other sees it within ~100ms without a refresh.
- **Installable PWA** — Apple touch icon, manifest, and a Workbox service
  worker so it keeps working offline after the first load. Supabase writes
  queue automatically when offline.

## Local dev

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve the built bundle locally
```

Node 20+ is recommended (the project is tested with Node 22).

## Supabase setup (one-time, ~5 min from iPhone)

All live state lives in a single row of a single Supabase table. This is
what makes realtime multi-user sync work.

1. **Create a project** at [supabase.com](https://supabase.com) → sign in
   with GitHub → **New Project**. Free tier is fine. Pick any name, any
   region; let Safari autofill generate a strong database password.
2. **Run this SQL** once, in the SQL Editor:
   ```sql
   create table movie_night (
     id int primary key,
     movies jsonb not null default '[]'::jsonb
   );
   insert into movie_night (id, movies) values (1, '[]'::jsonb);
   alter table movie_night enable row level security;
   create policy "anyone can read"  on movie_night for select using (true);
   create policy "anyone can write" on movie_night for update using (true);
   alter publication supabase_realtime add table movie_night;
   ```
3. **Copy the API credentials** from Project Settings → API:
   - Project URL → paste into a note
   - anon public key (NOT service_role) → paste into a note
4. **Add env vars to Vercel** (Project Settings → Environment Variables):
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
   - Enable for Production, Preview, and Development.
5. **Redeploy** on Vercel (or push a new commit to trigger it).

On the first load after deploy, the app will notice that the Supabase row
is empty and seed it with the contents of `movies.json` automatically. From
that point forward, Supabase is the source of truth and `movies.json` is
just a git-tracked backup / fallback for local dev.

**If env vars aren't set yet** the app still runs — it falls back to the
bundled `movies.json` and shows a banner reminding you to configure
Supabase. Edits won't persist until sync is wired up.

## Deploying to Vercel

The app is a static Vite bundle, so Vercel's defaults Just Work.

1. Push this repo to GitHub.
2. In Vercel, click **New Project** and import the repo.
3. Vercel auto-detects Vite. Accept the defaults (Framework: Vite).
4. Add the two Supabase env vars (see above).
5. Click **Deploy**. Every future push to `main` triggers a new deploy.
6. Open the production URL on your iPhone and use Safari's **Share → Add to
   Home Screen** to install it as a PWA. Send the URL to your partner and
   have them do the same — both phones will share the same live data.

## How edits work

- **Mark a wishlist movie as watched tonight** → detail screen → big red
  button → it moves to the Watched tab instantly on both phones.
- **Mark a movie as watched without a date** → detail screen → secondary
  "date unknown" button. It shows on Watched with "Date unknown" until you
  fill the date in.
- **Add a new movie** → tap the `+` button on either tab → fill in at least
  the title → Add. The form lets you toggle between Wishlist and Watched
  status and pick a date.
- **Edit any field** → Detail → Edit → Save. Changes write to Supabase and
  appear on the other phone within ~100ms.
- **Delete a movie** → Detail → scroll down → red "Delete movie" button.

## Data model

Each entry in `movies.json` (and each object inside the Supabase `movies`
JSONB column):

```ts
type Movie = {
  title: string;
  commonSenseAge: string | null;   // e.g. "6+"
  commonSenseScore: string | null; // reserved, unused for now
  rottenTomatoes: string | null;   // e.g. "97%"
  imdb: string | null;             // e.g. "7.9"
  watched: boolean;                // true → Watched tab, false → Wishlist
  dateWatched: string | null;      // ISO "YYYY-MM-DD" or null if unknown
  notes: string | null;
};
```

## Tech

Vite + React + TypeScript + Tailwind CSS + vite-plugin-pwa (Workbox) +
Supabase JS client. The icon PNGs in `public/icons/` are generated from
`scripts/generate-icons.mjs` using only Node built-ins — rerun
`node scripts/generate-icons.mjs` to regenerate them.

**Conflict model:** last-write-wins on the whole array. Two people editing
different movies at the same instant could in theory clobber one of the
edits; in practice this never happens because family movie-night edits are
seconds apart and the realtime subscription keeps both clients in sync
continuously.
