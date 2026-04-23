import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBanner } from './StatusBanner';

describe('StatusBanner', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders correctly with message', () => {
    render(<StatusBanner message="Information saved." />);
    expect(screen.getByText('Information saved.')).toBeInTheDocument();
  });

  it('renders with title', () => {
    render(<StatusBanner title="Success" message="Information saved." />);
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Information saved.')).toBeInTheDocument();
  });

  it('has correct accessibility attributes for info (default)', () => {
    const { container } = render(<StatusBanner message="Info" />);
    const banner = container.firstChild as HTMLElement;
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('has correct accessibility attributes for error', () => {
    const { container } = render(<StatusBanner type="error" message="Error" />);
    const banner = container.firstChild as HTMLElement;
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveAttribute('aria-live', 'assertive');
  });

  it('has correct accessibility attributes for warning', () => {
    const { container } = render(<StatusBanner type="warning" message="Warning" />);
    const banner = container.firstChild as HTMLElement;
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveAttribute('aria-live', 'assertive');
  });

  it('has correct accessibility attributes for success', () => {
    const { container } = render(<StatusBanner type="success" message="Success" />);
    const banner = container.firstChild as HTMLElement;
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('applies custom className', () => {
    const { container } = render(<StatusBanner message="Info" className="custom-class" />);
    const banner = container.firstChild as HTMLElement;
    expect(banner).toHaveClass('custom-class');
  });
});
