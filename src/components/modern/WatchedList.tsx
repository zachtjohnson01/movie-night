import { useLayoutEffect, useMemo, useState } from 'react';
import type { Movie } from '../../types';
import {
  ageBadgeClass,
  earliestWatched,
  formatDate,
  formatMonthYear,
  getDisplayTitle,
  sortWatched,
} from '../../format';
import {
  AMBER,
  BG,
  BG_2,
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
import Fab from './Fab';
import ReleaseDate from '../ReleaseDate';

type SortKey = 'watched-desc' | 'watched-asc' | 'year-desc' | 'year-asc';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'watched-desc', label: 'Watched: newest first' },
  { key: 'watched-asc',  label: 'Watched: oldest first' },
  { key: 'year-desc',    label: 'Released: newest first' },
  { key: 'year-asc',     label: 'Released: oldest first' },
];

type Props = {
  movies: Movie[];
  canWrite: boolean;
  isOwner: boolean;
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
  onBulkLink: () => void;
  onEnhanceAll: () => void;
};

export default function ModernWatchedList({
  movies,
  canWrite,
  isOwner,
  onSelect,
  onAdd,
  onBulkLink,
  onEnhanceAll,
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

  const [sortKey, setSortKey] = useState<SortKey>('watched-desc');
  const [sortOpen, setSortOpen] = useState(false);

  const watched = useMemo(
    () =>
      sortWatched(
        movies.filter((m) => m.watched),
        sortKey.endsWith('-desc') ? 'desc' : 'asc',
        sortKey.startsWith('year') ? 'year' : 'dateWatched',
      ),
    [movies, sortKey],
  );
  const earliest = useMemo(() => earliestWatched(watched), [watched]);
  const unlinkedCount = useMemo(
    () => watched.filter((m) => m.imdbId == null).length,
    [watched],
  );
  const enhanceableCount = useMemo(
    () => watched.filter((m) => m.production == null || m.awards == null).length,
    [watched],
  );
  const favorites = useMemo(
    () =>
      sortWatched(
        watched.filter((m) => m.favorite),
        'desc',
        'dateWatched',
      ),
    [watched],
  );

  const sortControl = (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setSortOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          borderRadius: 999,
          background: BG_3,
          border: `1px solid ${BORDER}`,
          color: INK_2,
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          minHeight: 36,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: 14, height: 14, flexShrink: 0 }}
          aria-hidden
        >
          {sortKey.endsWith('-desc') ? (
            <path d="M12 5v14M5 12l7 7 7-7" />
          ) : (
            <path d="M12 19V5M5 12l7-7 7 7" />
          )}
        </svg>
        <span>{SORT_OPTIONS.find((o) => o.key === sortKey)?.label}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            width: 14,
            height: 14,
            flexShrink: 0,
            transform: sortOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 150ms',
          }}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {sortOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 20 }}
            onClick={() => setSortOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              zIndex: 30,
              background: BG_2,
              border: `1px solid ${BORDER}`,
              borderRadius: 16,
              overflow: 'hidden',
              minWidth: 210,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          >
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => { setSortKey(opt.key); setSortOpen(false); }}
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '0 16px',
                  textAlign: 'left',
                  border: 'none',
                  color: sortKey === opt.key ? AMBER : INK_2,
                  fontFamily: SANS,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: sortKey === opt.key ? 'rgba(245,165,36,0.08)' : 'transparent',
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ width: 14, height: 14, flexShrink: 0 }}
                  aria-hidden
                >
                  {opt.key.endsWith('-desc') ? (
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  ) : (
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  )}
                </svg>
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

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
      {/* Header */}
      <div
        style={{
          padding:
            'calc(env(safe-area-inset-top) + 40px) 20px 0',
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
          Family Movie Night
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 48,
            lineHeight: 0.95,
            color: INK,
            fontWeight: 400,
            marginTop: 10,
            letterSpacing: -1.5,
          }}
        >
          <span style={{ fontStyle: 'italic' }}>{watched.length}</span> nights
          <br />
          <span
            style={{
              color: INK_2,
              fontStyle: 'italic',
              fontWeight: 300,
            }}
          >
            together.
          </span>
        </div>
        {earliest && (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13,
              color: INK_3,
              marginTop: 12,
              letterSpacing: 0.2,
            }}
          >
            Since {formatMonthYear(earliest)}.
          </div>
        )}
      </div>

      {watched.length > 0 &&
        ((canWrite && unlinkedCount > 0) || isOwner) && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              padding: '20px 20px 0',
            }}
          >
            {canWrite && unlinkedCount > 0 && (
              <button
                type="button"
                onClick={onBulkLink}
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
                  <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                  <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                </svg>
                Link {unlinkedCount} unlinked
              </button>
            )}
            {isOwner && (
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

      {watched.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Favorites */}
          <Section
            title="Favorites"
            action={favorites.length > 0 ? `${favorites.length} pinned` : undefined}
          >
            {favorites.length === 0 ? (
              <div
                style={{
                  padding: '4px 20px 4px',
                  fontFamily: SANS,
                  fontSize: 12,
                  color: INK_3,
                  fontStyle: 'italic',
                  lineHeight: 1.5,
                }}
              >
                Tap the star on a movie to pin your favorites here.
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 14,
                  padding: '0 20px',
                  overflowX: 'auto',
                  scrollbarWidth: 'none',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {favorites.map((m) => (
                  <button
                    key={m.id ?? m.title}
                    type="button"
                    onClick={() => onSelect(m)}
                    style={{
                      flexShrink: 0,
                      width: 108,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: INK,
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <ModernPoster movie={m} size={108} />
                    </div>
                    <div
                      style={{
                        fontFamily: SANS,
                        fontSize: 12,
                        color: INK,
                        fontWeight: 600,
                        marginTop: 8,
                        lineHeight: 1.25,
                        letterSpacing: -0.1,
                      }}
                    >
                      {getDisplayTitle(m)}
                    </div>
                    {m.dateWatched && (
                      <div
                        style={{
                          fontFamily: SANS,
                          fontSize: 11,
                          color: INK_3,
                          marginTop: 2,
                        }}
                      >
                        Watched {formatDate(m.dateWatched)}
                      </div>
                    )}
                    <ReleaseDate releaseDate={m.releaseDate} labeled />
                  </button>
                ))}
              </div>
            )}
          </Section>

          {/* The full reel */}
          <Section title="The full reel" action={sortControl}>
            <div>
              {watched.map((m) => (
                <ListRow
                  key={m.id ?? m.title}
                  movie={m}
                  onClick={() => onSelect(m)}
                />
              ))}
            </div>
          </Section>
        </>
      )}

      {canWrite && <Fab onClick={onAdd} />}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          padding: '0 20px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 22,
            color: INK,
            fontWeight: 500,
            letterSpacing: -0.4,
          }}
        >
          {title}
        </div>
        {action && (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 12,
              color: INK_3,
              fontWeight: 500,
            }}
          >
            {action}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function ListRow({
  movie: m,
  onClick,
}: {
  movie: Movie;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 20px',
        cursor: 'pointer',
        width: '100%',
        background: 'transparent',
        border: 'none',
        textAlign: 'left',
        color: INK,
        minHeight: 84,
      }}
    >
      <ModernPoster movie={m} size={54} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 16,
            color: INK,
            fontWeight: 600,
            letterSpacing: -0.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {getDisplayTitle(m)}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            marginTop: 3,
            flexWrap: 'wrap',
          }}
        >
          {m.dateWatched ? (
            <span
              style={{ fontFamily: SANS, fontSize: 12, color: INK_3 }}
            >
              Watched {formatDate(m.dateWatched)}
            </span>
          ) : (
            <span
              style={{
                fontFamily: SANS,
                fontSize: 12,
                color: AMBER,
                fontStyle: 'italic',
              }}
            >
              Watched date unknown
            </span>
          )}
        </div>
        <ReleaseDate releaseDate={m.releaseDate} labeled />
        <div style={{display: 'flex', alignItems: 'center', gap: 10, marginTop: 3}}>
          {m.rottenTomatoes && (
            <span
              style={{
                fontFamily: SANS,
                fontSize: 12,
                color: INK_2,
              }}
            >
              🍅 {m.rottenTomatoes}
            </span>
          )}
          {m.imdb && (
            <span
              style={{
                fontFamily: SANS,
                fontSize: 12,
                color: INK_2,
              }}
            >
              ★ {m.imdb}
            </span>
          )}
        </div>
      </div>
      {m.favorite && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={AMBER}
          aria-label="Favorite"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      )}
      {m.commonSenseAge && (
        <span
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold tabular-nums ${ageBadgeClass(
            m.commonSenseAge,
          )}`}
        >
          {m.commonSenseAge}
        </span>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '48px 24px 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 14,
          color: INK_2,
          lineHeight: 1.5,
        }}
      >
        No movies watched yet.
        <br />
        Pick something from Up Next to kick off Friday night.
      </div>
      <div
        style={{
          marginTop: 16,
          fontFamily: SANS,
          fontSize: 11,
          color: INK_3,
          fontStyle: 'italic',
        }}
      >
        Tap
        <span
          style={{
            display: 'inline-block',
            margin: '0 4px',
            padding: '2px 6px',
            borderRadius: 6,
            background: AMBER,
            color: '#1a1a1a',
            fontStyle: 'normal',
            fontWeight: 700,
          }}
        >
          ＋
        </span>
        to add a movie.
      </div>
      <div style={{ height: 12 }} />
      <div
        style={{
          margin: '16px 0 0',
          fontFamily: SANS,
          fontSize: 11,
          color: INK_3,
          letterSpacing: 2,
          textTransform: 'uppercase',
          fontWeight: 600,
          borderTop: `1px solid ${BORDER}`,
          paddingTop: 16,
        }}
      >
        Friday is coming.
      </div>
    </div>
  );
}
