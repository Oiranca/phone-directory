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
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
  isDestructive = false
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="backdrop:bg-gray-900/50 p-6 rounded-lg shadow-xl max-w-md w-full border-0 focus:outline-none"
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <h2 id={titleId} className="text-xl font-semibold mb-4 text-scs-ink">{title}</h2>
      <p id={messageId} className="text-gray-600 mb-8 leading-relaxed">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus-ring touch-target"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`px-4 py-2 text-sm font-medium text-white rounded-md focus-ring touch-target ${
            isDestructive ? 'state-destructive' : 'bg-scs-blue hover:bg-scs-blueDark'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
