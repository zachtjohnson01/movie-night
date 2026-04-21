import { useMemo } from 'react';
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
  BORDER,
  DISPLAY,
  INK,
  INK_2,
  INK_3,
  SANS,
} from './palette';
import ModernPoster from './ModernPoster';
import DesignToggle from './DesignToggle';
import Fab from './Fab';

type Props = {
  movies: Movie[];
  canWrite: boolean;
  onSelect: (movie: Movie) => void;
  onAdd: () => void;
  design: 'classic' | 'modern';
  onToggleDesign: () => void;
};

export default function ModernWatchedList({
  movies,
  canWrite,
  onSelect,
  onAdd,
  design,
  onToggleDesign,
}: Props) {
  const watched = useMemo(
    () => sortWatched(movies.filter((m) => m.watched)),
    [movies],
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
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
            Friday Movie Night
          </div>
          <DesignToggle design={design} onToggle={onToggleDesign} />
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
      </div>

      {watched.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Recently watched */}
          <Section
            title="Recently watched"
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
            <Section title="The full reel" action="by date">
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
