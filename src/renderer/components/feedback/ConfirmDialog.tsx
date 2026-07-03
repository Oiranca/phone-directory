import React, { useEffect, useId, useRef } from 'react';

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
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  // Keeps a reference to the dialog node even after React removes it from the
  // tree (which happens the same render that `isOpen` flips to false), so the
  // close/focus-restore logic below can still act on it imperatively.
  const lastDialogNodeRef = useRef<HTMLDialogElement | null>(null);
  const setDialogRef = (node: HTMLDialogElement | null) => {
    dialogRef.current = node;
    if (node) lastDialogNodeRef.current = node;
  };

  // The element that had focus right before the dialog opened, so it can be
  // restored once the dialog closes (either normally or via parent unmount).
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) {
        triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
        dialog.showModal();
        const focusTarget = !cancelDisabled
          ? cancelButtonRef.current
          : !confirmDisabled
            ? confirmButtonRef.current
            : null;
        focusTarget?.focus();
      }
    } else {
      const dialog = lastDialogNodeRef.current;
      if (dialog?.open) {
        dialog.close();
      }
      triggerRef.current?.focus();
      triggerRef.current = null;
    }
  }, [isOpen, cancelDisabled, confirmDisabled]);

  // Close the native dialog and restore focus to the trigger if the parent
  // unmounts this component while the dialog is still open. Uses
  // `lastDialogNodeRef`/`triggerRef` (not the possibly-nulled `dialogRef`)
  // because React detaches child refs before this cleanup runs.
  useEffect(() => {
    return () => {
      const dialog = lastDialogNodeRef.current;
      if (dialog?.open) {
        dialog.close();
      }
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
  }, []);

  if (!isOpen) return null;

  return (
    <dialog
      ref={setDialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!cancelDisabled) onCancel();
      }}
      className="backdrop:bg-slate-900/50 p-6 rounded-2xl shadow-xl max-w-md w-full border-0 focus:outline-none"
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <h2 id={titleId} className="text-xl font-semibold mb-4 text-scs-ink">{title}</h2>
      <p id={messageId} className="text-slate-600 mb-8 leading-relaxed">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          ref={cancelButtonRef}
          type="button"
          onClick={() => { if (!cancelDisabled) onCancel(); }}
          disabled={cancelDisabled}
          className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus-ring touch-target disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmButtonRef}
          type="button"
          onClick={() => { if (!confirmDisabled) onConfirm(); }}
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
