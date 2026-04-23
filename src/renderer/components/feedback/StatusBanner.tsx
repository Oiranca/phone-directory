import React from 'react';

interface StatusBannerProps {
  type?: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  className?: string;
}

export function StatusBanner({ type = 'info', title, message, className = '' }: StatusBannerProps) {
  const colors = {
    success: 'bg-green-50 text-green-900 border-green-200',
    error: 'bg-red-50 text-scs-danger border-red-200',
    warning: 'bg-orange-50 text-scs-warning border-orange-200',
    info: 'bg-scs-mist text-scs-blue border-blue-200',
  };

  const isAlert = type === 'error' || type === 'warning';

  return (
    <div
      className={`p-4 border rounded-md mb-4 ${colors[type]} ${className}`}
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
    >
      {title && <h3 className="font-semibold mb-1">{title}</h3>}
      <p className="text-sm">{message}</p>
    </div>
  );
}
