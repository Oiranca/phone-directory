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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  /** Capture the element that had focus before the dialog opened so we can restore it on close. */
  const triggerElementRef = useRef<Element | null>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) {
      // Capture the active element before showModal() steals focus.
      triggerElementRef.current = document.activeElement;
      dialog.showModal();
      // Move focus to the cancel button (safe default — avoids accidental destructive confirm).
      // If the cancel button is disabled, fall back to the first enabled button in the dialog.
      requestAnimationFrame(() => {
        const btn = cancelButtonRef.current;
        if (btn && !btn.disabled) {
          btn.focus();
        } else {
          dialogRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
        }
      });
    } else if (!isOpen) {
      // Close the dialog if it is still in the DOM — the component may have already rendered
      // null and removed the element before this effect fires.
      if (dialog && dialog.open) {
        dialog.close();
      }
      // Restore focus unconditionally so keyboard users keep their place even
      // when the dialog element was already removed from the DOM on re-render.
      const trigger = triggerElementRef.current;
      if (trigger instanceof HTMLElement) {
        requestAnimationFrame(() => {
          trigger.focus();
        });
      }
      triggerElementRef.current = null;
    }
  }, [isOpen]);

  // Unmount path: if the caller removes the component from the DOM while the
  // dialog is still showing (e.g. ImportExportPage sets conditional rendering to
  // false instead of passing isOpen=false), restore focus to the original trigger
  // element so keyboard users keep their place.
  useEffect(() => {
    return () => {
      if (dialogRef.current?.open) {
        dialogRef.current.close();
      }
      const trigger = triggerElementRef.current;
      if (trigger instanceof HTMLElement) {
        trigger.focus({ preventScroll: true });
      }
      triggerElementRef.current = null;
    };
  }, []); // empty deps — cleanup only runs on unmount

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!cancelDisabled) onCancel();
      }}
      className="backdrop:bg-slate-900/50 p-6 rounded-3xl shadow-xl max-w-md w-full border-0 focus:outline-none"
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
          className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-2xl hover:bg-slate-50 focus-ring touch-target disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          className={`px-4 py-2 text-sm font-medium text-white rounded-2xl focus-ring touch-target disabled:opacity-60 disabled:cursor-not-allowed ${
            isDestructive ? 'state-destructive' : 'bg-scs-blue hover:bg-scs-blueDark'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
