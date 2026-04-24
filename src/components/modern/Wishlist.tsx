import { useLayoutEffect, useMemo, useState } from 'react';
import type { Movie } from '../../types';
import { getDisplayTitle } from '../../format';
import {
  BG,
  BG_3,
  BORDER,
  DISPLAY,
  INK,
  INK_2,
  INK_3,
  SANS,
} from './palette';
import ModernPoster from './ModernPoster';
import Fab from './Fab';

type Props = {
  movies: Movie[];
  canWrite: boolean;
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
};

export default function ModernWishlist({
  movies,
  canWrite,
  onSelect,
  onAdd,
}: Props) {
  useLayoutEffect(() => {
    const toTop = () => {
      window.scrollTo(0, 0);
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = 0;
      }
    };
    toTop();
    const rafId = requestAnimationFrame(toTop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const [query, setQuery] = useState('');

  const wishAll = useMemo(
    () =>
      movies
        .filter((m) => !m.watched)
        .sort((a, b) =>
          getDisplayTitle(a).localeCompare(getDisplayTitle(b), undefined, {
            sensitivity: 'base',
          }),
        ),
    [movies],
  );

  const wish = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return wishAll;
    return wishAll.filter((m) => {
      const t = m.title.toLowerCase();
      const d = m.displayTitle?.toLowerCase() ?? '';
      return t.includes(q) || d.includes(q);
    });
  }, [wishAll, query]);

  return (
    <div
      style={{
        background: BG,
        minHeight: '100%',
        color: INK,
        fontFamily: SANS,
        paddingBottom: 140,
      }}
    >
      <div
        style={{
          padding:
            'calc(env(safe-area-inset-top) + 40px) 20px 12px',
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontSize: 11,
            color: INK_3,
            letterSpacing: 2,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          Wishlist
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 40,
            color: INK,
            fontWeight: 400,
            marginTop: 10,
            letterSpacing: -1.2,
            lineHeight: 1,
          }}
        >
          <span style={{ fontStyle: 'italic' }}>{wishAll.length}</span> in the
          <br />
          <span
            style={{
              color: INK_2,
              fontStyle: 'italic',
              fontWeight: 300,
            }}
          >
            queue.
          </span>
        </div>

        {/* Search */}
        <div
          style={{
            marginTop: 16,
            background: BG_3,
            border: `1px solid ${BORDER}`,
            borderRadius: 999,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={INK_3}
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            inputMode="search"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="Search titles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: INK,
              fontFamily: SANS,
              fontSize: 16,
              fontWeight: 500,
            }}
          />
        </div>
      </div>

      {wish.length === 0 ? (
        <div
          style={{
            padding: '32px 24px',
            textAlign: 'center',
            fontFamily: SANS,
            fontSize: 14,
            color: INK_3,
          }}
        >
          {query
            ? `Nothing matches “${query}”`
            : canWrite
              ? 'Your wishlist is empty. Tap + to add a movie.'
              : 'Your wishlist is empty.'}
        </div>
      ) : (
        <div
          style={{
            padding: '16px 20px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 12,
          }}
        >
          {wish.map((m) => (
            <button
              key={m.title}
              type="button"
              onClick={() => onSelect(m)}
              style={{
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                padding: 0,
                textAlign: 'left',
                color: INK,
              }}
            >
              <div style={{ position: 'relative' }}>
                <ModernPoster movie={m} size={96} />
                {m.commonSenseAge && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      fontFamily: SANS,
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#fff',
                      background: 'rgba(0,0,0,0.65)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      backdropFilter: 'blur(6px)',
                      WebkitBackdropFilter: 'blur(6px)',
                    }}
                  >
                    {m.commonSenseAge}
                  </div>
                )}
              </div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  color: INK,
                  fontWeight: 600,
                  marginTop: 6,
                  lineHeight: 1.2,
                  letterSpacing: -0.1,
                }}
              >
                {getDisplayTitle(m)}
              </div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 10,
                  color: INK_3,
                  marginTop: 2,
                }}
              >
                {m.rottenTomatoes && `🍅 ${m.rottenTomatoes}`}
                {m.rottenTomatoes && m.imdb && ' · '}
                {m.imdb && `★ ${m.imdb}`}
              </div>
            </button>
          ))}
        </div>
      )}

      {canWrite && <Fab onClick={onAdd} />}
    </div>
  );
}
