import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
  isDestructive = false,
  confirmDisabled = false,
  cancelDisabled = false
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  // P3: remembers the element that had focus before the dialog opened so it can be
  // restored once the dialog closes (see closeDialogAndRestoreFocus below).
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) {
      triggerElementRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      // Move focus to a safe, enabled action right after opening. Prefer Cancel
      // (the non-destructive default); fall back to the first enabled action
      // (Confirm) if Cancel is disabled, so keyboard users never land on nothing.
      const safeTarget = !cancelDisabled
        ? cancelButtonRef.current
        : !confirmDisabled
          ? confirmButtonRef.current
          : null;
      safeTarget?.focus();
    }
  }, [isOpen, cancelDisabled, confirmDisabled]);

  // P3: close the dialog and restore focus to the trigger element imperatively,
  // at the exact point closing is triggered (button click / native cancel event).
  // We cannot rely solely on an effect keyed off `isOpen`: once the parent flips
  // `isOpen` to false this component renders `null` on the very next render,
  // which removes the <dialog> node from the DOM (nulling dialogRef.current)
  // before any effect gets a chance to call dialog.close() or restore focus.
  const closeDialogAndRestoreFocus = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
    }
    const trigger = triggerElementRef.current;
    triggerElementRef.current = null;
    trigger?.focus();
  };

  // Safety net: if the parent unmounts this component entirely while the dialog
  // is still open (rather than flipping isOpen to false first), still close the
  // dialog and restore focus to the previously-focused trigger element. This
  // must be a layout effect: passive effect (useEffect) cleanups run after the
  // <dialog> ref has already been detached (set to null) during unmount, which
  // is too late to call dialog.close() or read dialogRef.current.
  useLayoutEffect(() => {
    return () => {
      if (dialogRef.current?.open) {
        closeDialogAndRestoreFocus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!cancelDisabled) {
          closeDialogAndRestoreFocus();
          onCancel();
        }
      }}
      className="backdrop:bg-gray-900/50 p-6 rounded-lg shadow-xl max-w-md w-full border-0 focus:outline-none"
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <h2 id={titleId} className="text-xl font-semibold mb-4 text-scs-ink">{title}</h2>
      <p id={messageId} className="text-gray-600 mb-8 leading-relaxed">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          ref={cancelButtonRef}
          type="button"
          onClick={() => {
            if (!cancelDisabled) {
              closeDialogAndRestoreFocus();
              onCancel();
            }
          }}
          disabled={cancelDisabled}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus-ring touch-target disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmButtonRef}
          type="button"
          onClick={() => {
            if (confirmDisabled) return;
            closeDialogAndRestoreFocus();
            onConfirm();
          }}
          disabled={confirmDisabled}
          className={`px-4 py-2 text-sm font-medium text-white rounded-md focus-ring touch-target disabled:opacity-60 disabled:cursor-not-allowed ${
            isDestructive ? 'state-destructive' : 'bg-scs-blue hover:bg-scs-blueDark'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
