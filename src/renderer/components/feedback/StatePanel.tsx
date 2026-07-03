import React, { useEffect, useState } from 'react';

interface StatePanelProps {
  title: string;
  message: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  titleAs?: 'div' | 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

export function StatePanel({ title, message, icon, action, titleAs = 'h2' }: StatePanelProps) {
  const TitleTag = titleAs;

  // WAI-ARIA live regions only announce *changes* to their accessible content —
  // they do not announce content that is already present at the moment the
  // region is registered by assistive tech. Since this panel's title/message
  // render synchronously at mount, marking the whole panel `aria-live` (as it
  // was before this fix) meant screen readers silently skipped the initial
  // announcement entirely.
  //
  // Fix: keep the visible title/message rendering immediately (no flicker for
  // sighted users), and drive the actual screen-reader announcement from a
  // separate, visually hidden `role="status"` region whose text starts empty
  // and is populated one tick after mount (via this effect). That populate
  // step is a genuine DOM content change happening *after* the region is
  // already registered, so assistive tech reliably announces it. On later
  // prop changes the same region is refreshed, which continues to announce
  // normally.
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setAnnouncement(`${title}. ${message}`);
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [title, message]);

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-gray-200 rounded-lg bg-gray-50 my-4">
      {icon && <div className="text-gray-400 mb-4" aria-hidden="true">{icon}</div>}
      <TitleTag className="text-lg font-semibold text-gray-900 mb-2">{title}</TitleTag>
      <p className="text-sm text-gray-600 max-w-sm mb-6">{message}</p>
      {action && <div>{action}</div>}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
