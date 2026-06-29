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

  it.each([
    { type: 'success' as const, srPrefix: 'Correcto:' },
    { type: 'error' as const, srPrefix: 'Error:' },
    { type: 'warning' as const, srPrefix: 'Aviso:' },
    { type: 'info' as const, srPrefix: 'Información:' },
  ])('$type banner exposes sr-only prefix "$srPrefix" and aria-hidden icon', ({ type, srPrefix }) => {
    const { container } = render(<StatusBanner type={type} message="Mensaje de prueba" />);

    // Prefijo sr-only presente en el DOM
    const srEl = screen.getByText(srPrefix);
    expect(srEl).toHaveClass('sr-only');

    // Icono SVG decorativo con aria-hidden
    const icon = container.querySelector('svg[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });
});
