# Friday Movie Night

A tiny, mobile-first PWA that tracks the Friday movie nights I watch with my
daughter. No backend, no accounts, no poster scraping — just a single
`movies.json` file committed to this repo and a dark-themed interface I can
use one-handed from my iPhone.

## What's in the app

- **Watched** tab — count header, date-descending list, one score chip per
  row (RT %, falling back to IMDb).
- **Wishlist** tab — alphabetical, title substring search, Common Sense Media
  age pill + inline RT/IMDb numbers.
- **Detail** screen — all ratings, notes textarea for watched movies, and a
  big "Mark as watched tonight" button for anything still on the wishlist.
- **Save/export flow** — any change produces the updated `movies.json` as a
  downloadable file *and* auto-copies it to the clipboard so I can paste it
  into GitHub on mobile and commit.
- **Installable PWA** — Apple touch icon, manifest, and a Workbox service
  worker so it keeps working offline after the first load.

## Local dev

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve the built bundle locally
```

Node 20+ is recommended (the project is tested with Node 22).

## Deploying to Vercel

The app is a static Vite bundle, so Vercel's defaults Just Work.

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. In Vercel, click **New Project** and import the repo.
3. Vercel auto-detects Vite. Accept the defaults:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`
4. Click **Deploy**. Every future push to `main` triggers a new deploy.
5. Open the production URL on your iPhone and use Safari's **Share → Add to
   Home Screen** to install it as a PWA.

No environment variables are needed. No secrets. No API keys.

## Adding a watched movie from my phone

The whole point of the app is that "saving" a change turns into a
copy-pasteable blob of JSON that I commit to this repo by hand. Here's the
full flow from the couch on a Friday night:

- **Open the PWA** from the home screen, find the movie on the **Wishlist**
  tab (use the search box if it's long), and tap it.
- **Tap "Mark as watched tonight"** on the Detail screen. The app sets
  `dateWatched` to today's local date and opens a bottom sheet — the updated
  `movies.json` is already on my clipboard.
- **Add a note** (optional): back on the Detail screen, type into the notes
  textarea and tap **Save notes**. That re-opens the export sheet with the
  freshly updated JSON copied to the clipboard.
- **Switch to GitHub mobile**, open this repo, navigate to `movies.json`, tap
  the pencil to edit, select all, paste, and commit directly to `main` with a
  short message like "watched Ponyo".
- **Wait ~30 seconds** for Vercel to redeploy, pull-to-refresh the PWA, and
  the movie moves from Wishlist to Watched with today's date at the top of
  the list.

To add a *new* title to the wishlist, I edit `movies.json` on GitHub directly
and append a new object following the existing shape — the app reads it on
next load.

## Data model

Each entry in `movies.json`:

```ts
type Movie = {
  title: string;
  commonSenseAge: string | null;   // e.g. "6+"
  commonSenseScore: string | null; // reserved, unused for now
  rottenTomatoes: string | null;   // e.g. "97%"
  imdb: string | null;             // e.g. "7.9"
  dateWatched: string | null;      // ISO "YYYY-MM-DD" or null if unwatched
  notes: string | null;
};
```

## Tech

Vite + React + TypeScript + Tailwind CSS + vite-plugin-pwa (Workbox). The
icon PNGs in `public/icons/` are generated from `scripts/generate-icons.mjs`
using only Node built-ins — rerun `node scripts/generate-icons.mjs` to
regenerate them.
