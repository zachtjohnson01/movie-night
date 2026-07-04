// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ModernWatchedList from './WatchedList';
import { emptyMovie } from '../../format';
import type { Movie } from '../../types';

afterEach(cleanup);

function seen(title: string, over: Partial<Movie> = {}): Movie {
  return {
    ...emptyMovie(true),
    id: `id-${title}`,
    title,
    dateWatched: '2025-01-01',
    ...over,
  };
}

const baseProps = {
  canWrite: true,
  isOwner: false,
  onSelect: () => {},
  onAdd: () => {},
  onBulkLink: () => {},
  onEnhanceAll: () => {},
};

describe('ModernWatchedList owner actions', () => {
  it('offers bulk-link when some watched movies are unlinked', () => {
    const onBulkLink = vi.fn();
    render(
      <ModernWatchedList
        {...baseProps}
        onBulkLink={onBulkLink}
        movies={[seen('A', { imdbId: null }), seen('B', { imdbId: 'tt1' })]}
      />,
    );
    const btn = screen.getByText(/Link 1 unlinked/);
    fireEvent.click(btn);
    expect(onBulkLink).toHaveBeenCalled();
  });

  it('hides bulk-link when everything is linked', () => {
    render(
      <ModernWatchedList
        {...baseProps}
        movies={[seen('A', { imdbId: 'tt1' })]}
      />,
    );
    expect(screen.queryByText(/unlinked/)).toBeNull();
  });

  it('shows enhance-all only for the owner', () => {
    const onEnhanceAll = vi.fn();
    const { rerender } = render(
      <ModernWatchedList {...baseProps} movies={[seen('A', { imdbId: 'tt1' })]} />,
    );
    expect(screen.queryByText(/Enhance|Refresh/)).toBeNull();

    rerender(
      <ModernWatchedList
        {...baseProps}
        isOwner
        onEnhanceAll={onEnhanceAll}
        movies={[seen('A', { imdbId: 'tt1', production: null })]}
      />,
    );
    fireEvent.click(screen.getByText(/Enhance|Refresh/));
    expect(onEnhanceAll).toHaveBeenCalled();
  });
});
