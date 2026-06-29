import React from 'react';

interface StatusBannerProps {
  type?: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  className?: string;
}

type BannerType = NonNullable<StatusBannerProps['type']>;

/** Prefijos sr-only por tipo — los lectores de pantalla los anuncian antes del mensaje. */
const SR_PREFIXES: Record<BannerType, string> = {
  success: 'Correcto:',
  error: 'Error:',
  warning: 'Aviso:',
  info: 'Información:',
};

/** Icono SVG decorativo por tipo, oculto a tecnologías asistivas (aria-hidden). */
const BannerIcon = ({ type }: { type: BannerType }) => {
  if (type === 'success') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 10.5l2.5 2 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'warning') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0">
        <path d="M10 3L18 17H2L10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M10 9v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="14.5" r="0.75" fill="currentColor" />
      </svg>
    );
  }
  // info
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9.5V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="7" r="0.75" fill="currentColor" />
    </svg>
  );
};

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
      <div className="flex items-start gap-2">
        <BannerIcon type={type} />
        <div className="min-w-0 flex-1">
          <span className="sr-only">{SR_PREFIXES[type]}</span>
          {title && <h3 className="font-semibold mb-1">{title}</h3>}
          <p className="text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}
