import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { NotFoundPage } from './NotFoundPage';

afterEach(cleanup);

describe('NotFoundPage', () => {
  it('renders without crashing', () => {
    render(<NotFoundPage />);
  });

  it('shows the not-found heading', () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Pantalla no encontrada');
  });

  it('shows the explanatory copy', () => {
    render(<NotFoundPage />);
    expect(
      screen.getByText(
        'No hemos encontrado esta página. Puede que el enlace esté desactualizado o que la dirección tenga un error; vuelve al directorio para seguir trabajando.'
      )
    ).toBeInTheDocument();
  });

  it('associates the section with its heading via aria-labelledby', () => {
    render(<NotFoundPage />);
    const heading = screen.getByRole('heading', { level: 2 });
    const section = heading.closest('section');
    expect(section).toHaveAttribute('aria-labelledby', heading.id);
    expect(heading.id).toBeTruthy();
  });
});
