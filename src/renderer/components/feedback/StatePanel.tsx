import React from 'react';

interface StatePanelProps {
  title: string;
  message: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  titleAs?: 'div' | 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

export function StatePanel({ title, message, icon, action, titleAs = 'h2' }: StatePanelProps) {
  const TitleTag = titleAs;

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-gray-200 rounded-lg bg-gray-50 my-4" role="status" aria-live="polite">
      {icon && <div className="text-gray-400 mb-4" aria-hidden="true">{icon}</div>}
      <TitleTag className="text-lg font-semibold text-gray-900 mb-2">{title}</TitleTag>
      <p className="text-sm text-gray-600 max-w-sm mb-6">{message}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
