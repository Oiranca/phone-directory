import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect } from 'vitest';
import { NotFoundPage } from './NotFoundPage';

afterEach(cleanup);

const renderPage = () =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NotFoundPage />
    </MemoryRouter>
  );

describe('NotFoundPage', () => {
  it('renders without crashing', () => {
    renderPage();
  });

  it('shows the not-found heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Pantalla no encontrada');
  });

  it('shows the explanatory copy without MVP jargon', () => {
    renderPage();
    expect(screen.getByText(/Esta dirección no existe en la aplicación/i)).toBeInTheDocument();
    expect(screen.queryByText(/MVP/)).not.toBeInTheDocument();
  });

  it('has a link back to the home page', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /volver al inicio/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });

  it('section has aria-labelledby pointing to the heading', () => {
    renderPage();
    const section = screen.getByRole('region');
    expect(section).toHaveAttribute('aria-labelledby', 'not-found-title');
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveAttribute('id', 'not-found-title');
  });
});
