import { useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Movie } from '../../types';
import { getDisplayTitle, sortWishlist } from '../../format';
import {
  AMBER,
  BG,
  BG_3,
  BORDER,
  DISPLAY,
  INK,
  INK_2,
  INK_3,
  PILL_AMBER,
  PILL_NEUTRAL,
  SANS,
} from './palette';
import ModernPoster from './ModernPoster';
import ReleaseDate from '../ReleaseDate';
import Fab from './Fab';

type Props = {
  movies: Movie[];
  canWrite: boolean;
  isOwner: boolean;
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
  onEnhanceAll: () => void;
  onReorder: (orderedTitles: string[]) => void;
};

export default function ModernWishlist({
  movies,
  canWrite,
  isOwner,
  onSelect,
  onAdd,
  onEnhanceAll,
  onReorder,
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
  const [reordering, setReordering] = useState(false);

  // Respect the user's manual order (wishlistOrder), falling back to
  // alphabetical — same as the classic Wishlist, so a reorder is visible here.
  const wishAll = useMemo(
    () => sortWishlist(movies.filter((m) => !m.watched)),
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

  const enhanceableCount = useMemo(
    () => wishAll.filter((m) => m.production == null || m.awards == null).length,
    [wishAll],
  );
  const canReorder = canWrite && wishAll.length >= 2;

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= wishAll.length) return;
    const next = [...wishAll];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next.map((m) => m.title));
  }

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
      <div style={{ padding: 'calc(env(safe-area-inset-top) + 40px) 20px 12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
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
              Up Next
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
              <span style={{ color: INK_2, fontStyle: 'italic', fontWeight: 300 }}>
                queue.
              </span>
            </div>
          </div>
          {reordering && (
            <button
              type="button"
              onClick={() => setReordering(false)}
              style={{
                ...PILL_AMBER,
                background: AMBER,
                color: BG,
                border: 'none',
                fontWeight: 700,
              }}
            >
              Done
            </button>
          )}
        </div>

        {!reordering && (
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
        )}

        {!reordering &&
          !query &&
          (canReorder || (isOwner && wishAll.length > 0)) && (
            <div
              style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}
            >
              {canReorder && (
                <button
                  type="button"
                  onClick={() => setReordering(true)}
                  style={PILL_NEUTRAL}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={15}
                    height={15}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                  Reorder
                </button>
              )}
              {isOwner && wishAll.length > 0 && (
                <button
                  type="button"
                  onClick={onEnhanceAll}
                  style={enhanceableCount > 0 ? PILL_AMBER : PILL_NEUTRAL}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={15}
                    height={15}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                  </svg>
                  {enhanceableCount > 0
                    ? `Enhance ${enhanceableCount} with Claude`
                    : 'Refresh studio + awards'}
                </button>
              )}
            </div>
          )}
      </div>

      {reordering ? (
        <div style={{ padding: '4px 12px 0' }}>
          {wishAll.map((m, i) => (
            <div
              key={m.id ?? m.title}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 8px',
              }}
            >
              <ModernPoster movie={m} size={52} />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: SANS,
                  fontSize: 15,
                  fontWeight: 600,
                  color: INK,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {getDisplayTitle(m)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${getDisplayTitle(m)} up`}
                  style={{ ...REORDER_BTN, opacity: i === 0 ? 0.3 : 1 }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={18}
                    height={18}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === wishAll.length - 1}
                  aria-label={`Move ${getDisplayTitle(m)} down`}
                  style={{
                    ...REORDER_BTN,
                    opacity: i === wishAll.length - 1 ? 0.3 : 1,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={18}
                    height={18}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : wish.length === 0 ? (
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
              ? 'Your queue is empty. Tap + to add a movie.'
              : 'Your queue is empty.'}
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
              key={m.id ?? m.title}
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
              <ReleaseDate releaseDate={m.releaseDate} />
            </button>
          ))}
        </div>
      )}

      {canWrite && !reordering && <Fab onClick={onAdd} />}
    </div>
  );
}

const REORDER_BTN: CSSProperties = {
  minHeight: 40,
  minWidth: 40,
  borderRadius: 12,
  background: BG_3,
  border: `1px solid ${BORDER}`,
  color: INK,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};
