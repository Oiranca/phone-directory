import React from 'react';

interface FieldHintProps {
  id: string;
  children: React.ReactNode;
}

export function FieldHint({ id, children }: FieldHintProps) {
  if (!children) return null;
  return (
    <div id={id} className="text-sm text-gray-600 mt-1">
      {children}
    </div>
  );
}
