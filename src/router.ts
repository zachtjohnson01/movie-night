import { useEffect, useState } from 'react';

// Hand-rolled router. Routes that are real URLs (shareable, refreshable,
// browser-back-able) live here. Modal-ish flows (creating a new movie,
// downvoting a candidate, the pool admin screen) stay as transient
// component state — they're not worth a URL.
export type Route =
  | { kind: 'landing' }
  | { kind: 'families' }
  | { kind: 'family'; slug: string }
  | { kind: 'movie'; slug: string; title: string }
  | { kind: 'settings'; slug: string }
  | { kind: 'onboard' }
  | { kind: 'auth-callback' };

// Until multi-family ships (PRs 2–5), every URL maps to the Johnsons'
// family. This constant is the bridge: legacy `?m=<title>` links and any
// in-app navigation that doesn't yet know a slug fall back to this.
export const DEFAULT_FAMILY_SLUG = 'johnson';

export function parseRoute(pathname: string, search: string): Route {
  if (pathname === '/' || pathname === '') {
    // Legacy `?m=<title>` deep-links predate path-based routing. Treat
    // them as a movie route under the default family so existing
    // iMessage shares keep landing on the right view.
    const title = new URLSearchParams(search).get('m');
    if (title) return { kind: 'movie', slug: DEFAULT_FAMILY_SLUG, title };
    return { kind: 'landing' };
  }

  if (pathname === '/families' || pathname === '/families/') {
    return { kind: 'families' };
  }
  if (pathname === '/onboard') return { kind: 'onboard' };
  if (pathname === '/auth/callback') return { kind: 'auth-callback' };

  let m = pathname.match(/^\/family\/([^/]+)\/m\/(.+?)\/?$/);
  if (m) {
    return {
      kind: 'movie',
      slug: decodeURIComponent(m[1]),
      title: decodeURIComponent(m[2]),
    };
  }

  m = pathname.match(/^\/family\/([^/]+)\/settings\/?$/);
  if (m) return { kind: 'settings', slug: decodeURIComponent(m[1]) };

  m = pathname.match(/^\/family\/([^/]+)\/?$/);
  if (m) return { kind: 'family', slug: decodeURIComponent(m[1]) };

  // Unknown path → landing. Vercel's SPA fallback already serves
  // index.html for unknown paths; this keeps the SPA consistent.
  return { kind: 'landing' };
}

export function pathFromRoute(route: Route): string {
  switch (route.kind) {
    case 'landing':
      return '/';
    case 'families':
      return '/families';
    case 'family':
      return `/family/${encodeURIComponent(route.slug)}`;
    case 'movie':
      return `/family/${encodeURIComponent(route.slug)}/m/${encodeURIComponent(route.title)}`;
    case 'settings':
      return `/family/${encodeURIComponent(route.slug)}/settings`;
    case 'onboard':
      return '/onboard';
    case 'auth-callback':
      return '/auth/callback';
  }
}

function readRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'landing' };
  return parseRoute(window.location.pathname, window.location.search);
}

// Browser fires `popstate` on back/forward, but not on programmatic
// pushState/replaceState. We notify subscribers directly so in-app
// navigation triggers a re-render the same way.
const subscribers = new Set<() => void>();
function notify() {
  subscribers.forEach((fn) => fn());
}

export function pushPath(path: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, '', path);
  notify();
}

export function replacePath(path: string) {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', path);
  notify();
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    subscribers.add(update);
    window.addEventListener('popstate', update);
    return () => {
      subscribers.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return route;
}
