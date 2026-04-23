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
  SANS,
} from './palette';
import ModernPoster from './ModernPoster';
import Fab from './Fab';

type SortKey = 'watched-desc' | 'watched-asc' | 'year-desc' | 'year-asc';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'watched-desc', label: 'Watched: newest first' },
  { key: 'watched-asc',  label: 'Watched: oldest first' },
  { key: 'year-desc',    label: 'Released: newest first' },
  { key: 'year-asc',     label: 'Released: oldest first' },
];

const RECENT_LABEL: Record<SortKey, string> = {
  'watched-desc': 'Recently watched',
  'watched-asc':  'First watches',
  'year-desc':    'Latest releases',
  'year-asc':     'Classic picks',
};

const REEL_ACTION: Record<SortKey, string> = {
  'watched-desc': 'by date',
  'watched-asc':  'by date',
  'year-desc':    'by year',
  'year-asc':     'by year',
};

type Props = {
  movies: Movie[];
  canWrite: boolean;
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
};

export default function ModernWatchedList({
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
  const recent = useMemo(() => watched.slice(0, 8), [watched]);
  const older = useMemo(() => watched.slice(8), [watched]);

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
            Since {formatMonthYear(earliest)} · counting every Friday.
          </div>
        )}

        {/* Sort control */}
        <div style={{ marginTop: 16, position: 'relative', display: 'inline-block' }}>
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
                  left: 0,
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
      </div>

      {watched.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Recently watched */}
          <Section
            title={RECENT_LABEL[sortKey]}
            action={`${recent.length} this season`}
          >
            <div
              style={{
                display: 'flex',
                gap: 14,
                padding: '0 20px',
                overflowX: 'auto',
                scrollbarWidth: 'none',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {recent.map((m) => (
                <button
                  key={m.title}
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
                  <ModernPoster movie={m} size={108} />
                  <div
                    style={{
                      fontFamily: SANS,
                      fontSize: 12,
                      color: INK,
                      fontWeight: 600,
                      marginTop: 8,
                      lineHeight: 1.25,
                      letterSpacing: -0.1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
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
                      {formatDate(m.dateWatched)}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </Section>

          {/* The full reel */}
          {older.length > 0 && (
            <Section title="The full reel" action={REEL_ACTION[sortKey]}>
              <div>
                {older.map((m) => (
                  <ListRow
                    key={m.title}
                    movie={m}
                    onClick={() => onSelect(m)}
                  />
                ))}
              </div>
            </Section>
          )}
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
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          padding: '0 20px 12px',
          display: 'flex',
          alignItems: 'baseline',
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
              {formatDate(m.dateWatched)}
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
              date unknown
            </span>
          )}
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
        Pick something from the Wishlist to kick off Friday night.
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
