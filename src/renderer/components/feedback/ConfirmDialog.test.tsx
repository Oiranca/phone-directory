import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

// Mocking showModal and close for HTMLDialogElement as they are not implemented in JSDOM
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) {
    this.open = false;
  });
});

describe('ConfirmDialog', () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    isOpen: true,
    title: 'Confirm Delete',
    message: 'Are you sure you want to delete this?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders correctly when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(defaultProps.onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('uses custom labels', () => {
    render(
      <ConfirmDialog 
        {...defaultProps} 
        confirmLabel="Eliminar" 
        cancelLabel="Volver" 
      />
    );
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
  });

  it('applies destructive styling when isDestructive is true', () => {
    render(<ConfirmDialog {...defaultProps} isDestructive={true} />);
    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmButton).toHaveClass('state-destructive');
  });
});
