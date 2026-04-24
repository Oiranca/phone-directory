import React from 'react';

interface FieldErrorProps {
  id: string;
  error?: string | null;
}

export function FieldError({ id, error }: FieldErrorProps) {
  if (!error) return null;
  return (
    <div id={id} className="text-sm text-scs-danger mt-1 font-medium" role="alert" aria-live="assertive">
      {error}
    </div>
  );
}
