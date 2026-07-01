import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const originalHTMLDialogElement = globalThis.HTMLDialogElement;
let dialogPrototype: (HTMLElement & { showModal?: () => void; close?: () => void }) | undefined;
let originalShowModal: (() => void) | undefined;
let originalClose: (() => void) | undefined;

// Mocking showModal and close for HTMLDialogElement as they are not implemented in JSDOM
beforeAll(() => {
  if (typeof globalThis.HTMLDialogElement === 'undefined') {
    class HTMLDialogElementStub extends HTMLElement {
      open = false;
    }

    vi.stubGlobal('HTMLDialogElement', HTMLDialogElementStub);
  }

  dialogPrototype =
    typeof globalThis.HTMLDialogElement !== 'undefined'
      ? globalThis.HTMLDialogElement.prototype
      : HTMLElement.prototype;

  originalShowModal = dialogPrototype.showModal;
  originalClose = dialogPrototype.close;

  dialogPrototype.showModal = vi.fn(function(this: HTMLElement & { open?: boolean }) {
    this.open = true;
  });
  dialogPrototype.close = vi.fn(function(this: HTMLElement & { open?: boolean }) {
    this.open = false;
  });
});

afterAll(() => {
  if (dialogPrototype) {
    dialogPrototype.showModal = originalShowModal;
    dialogPrototype.close = originalClose;
  }

  if (originalHTMLDialogElement) {
    vi.stubGlobal('HTMLDialogElement', originalHTMLDialogElement);
  } else {
    vi.unstubAllGlobals();
  }
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
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(defaultProps.onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(<ConfirmDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('prevents native cancel desync and delegates closing through onCancel', () => {
    render(<ConfirmDialog {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    const cancelEvent = new Event('cancel', { cancelable: true });

    fireEvent(dialog, cancelEvent);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('wires unique accessible ids for title and message', () => {
    const { rerender } = render(<ConfirmDialog {...defaultProps} />);
    const firstDialog = screen.getByRole('dialog');
    const firstTitleId = firstDialog.getAttribute('aria-labelledby');
    const firstMessageId = firstDialog.getAttribute('aria-describedby');

    rerender(
      <div>
        <ConfirmDialog {...defaultProps} />
        <ConfirmDialog {...defaultProps} title="Otro diálogo" />
      </div>
    );

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs[0]?.getAttribute('aria-labelledby')).not.toBe(dialogs[1]?.getAttribute('aria-labelledby'));
    expect(dialogs[0]?.getAttribute('aria-describedby')).not.toBe(dialogs[1]?.getAttribute('aria-describedby'));
    expect(firstTitleId).toBeTruthy();
    expect(firstMessageId).toBeTruthy();
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
    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).toHaveClass('state-destructive');
  });

  // ── Acceptance criterion 1: disabled-confirm state ──────────────────────────

  it('marks confirm button as disabled when confirmDisabled is true', () => {
    render(<ConfirmDialog {...defaultProps} confirmDisabled={true} />);
    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).toBeDisabled();
  });

  it('confirm button is not disabled by default', () => {
    render(<ConfirmDialog {...defaultProps} />);
    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).not.toBeDisabled();
  });

  it('does not mark confirm button as disabled when confirmDisabled is false', () => {
    render(<ConfirmDialog {...defaultProps} confirmDisabled={false} />);
    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).not.toBeDisabled();
  });

  it('marks cancel button as disabled when cancelDisabled is true', () => {
    render(<ConfirmDialog {...defaultProps} cancelDisabled={true} />);
    const cancelButton = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancelButton).toBeDisabled();
  });

  it('does not fire onCancel when cancel button is clicked while cancelDisabled is true', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} cancelDisabled={true} />);
    // The onClick guard (`if (!cancelDisabled) onCancel()`) prevents the call
    // even when fireEvent.click bypasses the disabled attribute.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  // ── Acceptance criterion 2: Escape-to-dismiss ────────────────────────────────

  it('fires onCancel when the native cancel event (Escape) is dispatched on the dialog', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('prevents the native cancel event default to keep dialog state under React control', () => {
    render(<ConfirmDialog {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    const cancelEvent = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
  });

  it('does not fire onCancel on Escape when cancelDisabled is true', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} cancelDisabled={true} />);
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  // ── Focus restoration on unmount path ───────────────────────────────────────
  // Callers such as ImportExportPage remove the component from the DOM instead
  // of passing isOpen=false, so the mounted-path focus restore never runs.
  // A cleanup effect on the empty-dep useEffect handles this path.

  it('restores focus to the trigger element when unmounted while the dialog is showing', () => {
    const Wrapper = ({ show }: { show: boolean }) => (
      <>
        <button type="button" aria-label="Abrir diálogo">Abrir</button>
        {show && (
          <ConfirmDialog
            isOpen={true}
            title="Test"
            message="Test message"
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          />
        )}
      </>
    );

    // Render without the dialog, focus the trigger button so it is captured as
    // document.activeElement when the dialog mounts.
    const { rerender } = render(<Wrapper show={false} />);
    const trigger = screen.getByRole('button', { name: 'Abrir diálogo' });
    trigger.focus();
    expect(trigger).toHaveFocus();

    // Mount the dialog — the isOpen effect captures document.activeElement (trigger)
    // and calls showModal().
    rerender(<Wrapper show={true} />);

    // Unmount the dialog by removing it from the tree (simulates caller toggling
    // conditional rendering to false without passing isOpen=false).
    rerender(<Wrapper show={false} />);

    // The unmount cleanup effect must have restored focus to the trigger.
    expect(trigger).toHaveFocus();
  });
});
