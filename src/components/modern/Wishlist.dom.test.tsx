// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ModernWishlist from './Wishlist';
import { emptyMovie } from '../../format';
import type { Movie } from '../../types';

afterEach(cleanup);

function wish(title: string, order: number | null, over: Partial<Movie> = {}): Movie {
  return { ...emptyMovie(false), id: `id-${title}`, title, wishlistOrder: order, ...over };
}

const baseProps = {
  canWrite: true,
  isOwner: false,
  onSelect: () => {},
  onAdd: () => {},
  onEnhanceAll: () => {},
  onReorder: () => {},
};

describe('ModernWishlist', () => {
  it('renders queued titles (respecting wishlistOrder)', () => {
    render(
      <ModernWishlist
        {...baseProps}
        movies={[wish('Bravo', 1), wish('Alpha', 0)]}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
  });

  it('offers Reorder when 2+ items and the user can write', () => {
    render(<ModernWishlist {...baseProps} movies={[wish('A', 0), wish('B', 1)]} />);
    expect(screen.getByText('Reorder')).toBeInTheDocument();
  });

  it('hides Reorder for a single item', () => {
    render(<ModernWishlist {...baseProps} movies={[wish('A', 0)]} />);
    expect(screen.queryByText('Reorder')).toBeNull();
  });

  it('reorders via the move buttons, emitting the new title order', () => {
    const onReorder = vi.fn();
    render(
      <ModernWishlist
        {...baseProps}
        onReorder={onReorder}
        movies={[wish('A', 0), wish('B', 1)]}
      />,
    );
    fireEvent.click(screen.getByText('Reorder'));
    fireEvent.click(screen.getByLabelText('Move B up'));
    expect(onReorder).toHaveBeenCalledWith(['B', 'A']);
  });

  it('fires enhance-all for the owner', () => {
    const onEnhanceAll = vi.fn();
    render(
      <ModernWishlist
        {...baseProps}
        isOwner
        onEnhanceAll={onEnhanceAll}
        movies={[wish('A', null, { production: null, awards: null })]}
      />,
    );
    fireEvent.click(screen.getByText(/Enhance|Refresh/));
    expect(onEnhanceAll).toHaveBeenCalled();
  });

  it('does not offer owner actions to a non-owner', () => {
    render(<ModernWishlist {...baseProps} movies={[wish('A', 0)]} />);
    expect(screen.queryByText(/Enhance|Refresh/)).toBeNull();
  });
});
