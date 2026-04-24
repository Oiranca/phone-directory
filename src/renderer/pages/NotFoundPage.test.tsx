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
    expect(screen.getByText('La ruta solicitada no existe en este MVP.')).toBeInTheDocument();
  });
});
