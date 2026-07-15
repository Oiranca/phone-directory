import { createRef } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatePanel } from './StatePanel';

describe('StatePanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders correctly with title and message', () => {
    render(<StatePanel title="No Contacts" message="Your contact list is empty." />);
    expect(screen.getByText('No Contacts')).toBeInTheDocument();
    expect(screen.getByText('Your contact list is empty.')).toBeInTheDocument();
  });

  it('renders with icon', () => {
    render(
      <StatePanel 
        title="Error" 
        message="An error occurred" 
        icon={<span data-testid="error-icon" />} 
      />
    );
    expect(screen.getByTestId('error-icon')).toBeInTheDocument();
  });

  it('renders with action', () => {
    render(
      <StatePanel 
        title="Empty" 
        message="List is empty" 
        action={<button>Add Contact</button>} 
      />
    );
    expect(screen.getByRole('button', { name: 'Add Contact' })).toBeInTheDocument();
  });

  it('exposes a polite status region for assistive tech', () => {
    render(<StatePanel title="Loading" message="Please wait..." />);
    // The live region moved off the visible panel wrapper (whose
    // content is already present at mount and therefore never announced) and
    // onto a dedicated visually hidden status region — see StatePanel.tsx.
    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(statusRegion).toHaveClass('sr-only');
  });

  it('announces the title and message to screen readers shortly after mount', async () => {
    render(<StatePanel title="Loading" message="Please wait..." />);
    const statusRegion = screen.getByRole('status');

    // The status region starts empty on mount — content is populated one tick
    // later so assistive tech treats it as a genuine change and announces it,
    // instead of silently skipping content that was already there when the
    // live region registered.
    expect(statusRegion).toHaveTextContent('');

    await waitFor(() => {
      expect(statusRegion).toHaveTextContent('Loading. Please wait...');
    });
  });

  it('renders the title with the requested tag', () => {
    render(<StatePanel title="Warning" message="Check this state." titleAs="h2" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Warning' })).toBeInTheDocument();
  });

  it('uses role="alert" and aria-live="assertive" for error states', () => {
    const { container } = render(
      <StatePanel role="alert" title="Error al cargar" message="No se pudieron cargar los datos." />
    );
    const panel = container.firstChild as HTMLElement;
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders an action element when role="alert"', () => {
    render(
      <StatePanel
        role="alert"
        title="Error"
        message="Fallo al cargar."
        action={<button type="button">Reintentar</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('forwards titleRef to the title element and makes it programmatically focusable', () => {
    const titleRef = createRef<HTMLHeadingElement>();
    render(<StatePanel title="Sin resultados" message="No hay nada que mostrar." titleRef={titleRef} />);

    const heading = screen.getByRole('heading', { name: 'Sin resultados' });
    expect(titleRef.current).toBe(heading);
    expect(heading).toHaveAttribute('tabIndex', '-1');

    heading.focus();
    expect(document.activeElement).toBe(heading);
  });

  it('does not add tabIndex to the title when no titleRef is given', () => {
    render(<StatePanel title="Sin resultados" message="No hay nada que mostrar." />);
    expect(screen.getByRole('heading', { name: 'Sin resultados' })).not.toHaveAttribute('tabIndex');
  });
});
