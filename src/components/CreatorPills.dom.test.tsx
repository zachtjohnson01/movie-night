// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CreatorPills from './CreatorPills';

afterEach(cleanup);

describe('CreatorPills (read-only)', () => {
  it('renders each name as a pill', () => {
    render(<CreatorPills readOnly names={['Brad Bird', 'Pete Docter']} />);
    expect(screen.getByText('Brad Bird')).toBeInTheDocument();
    expect(screen.getByText('Pete Docter')).toBeInTheDocument();
  });

  it('shows an em dash when there are no names', () => {
    render(<CreatorPills readOnly names={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('CreatorPills (editable)', () => {
  it('commits on comma and skips a case-insensitive duplicate', () => {
    const onChange = vi.fn();
    render(<CreatorPills names={['Brad Bird']} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Add name/i);

    fireEvent.change(input, { target: { value: 'brad bird,' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Pete Docter,' } });
    expect(onChange).toHaveBeenCalledWith(['Brad Bird', 'Pete Docter']);
  });

  it('removes a name via its × button', () => {
    const onChange = vi.fn();
    render(<CreatorPills names={['Brad Bird', 'Pete Docter']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove Brad Bird'));
    expect(onChange).toHaveBeenCalledWith(['Pete Docter']);
  });
});
