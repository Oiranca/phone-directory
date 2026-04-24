import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FieldError } from './FieldError';

describe('FieldError', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders correctly with an error message', () => {
    render(<FieldError id="error-id" error="This is an error" />);
    const errorElement = screen.getByText('This is an error');
    expect(errorElement).toBeInTheDocument();
    expect(errorElement).toHaveAttribute('id', 'error-id');
    expect(errorElement).toHaveAttribute('role', 'alert');
    expect(errorElement).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders nothing when no error is provided', () => {
    const { container } = render(<FieldError id="error-id" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when error is null', () => {
    const { container } = render(<FieldError id="error-id" error={null} />);
    expect(container.firstChild).toBeNull();
  });
});
