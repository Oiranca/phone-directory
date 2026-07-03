import React, { useEffect, useState } from 'react';

interface StatePanelProps {
  title: string;
  message: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  titleAs?: 'div' | 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  /**
   * Overrides the default ARIA role.
   * Use "alert" for error states that require immediate user attention (aria-live="assertive").
   * Defaults to "status" (aria-live="polite") for non-critical states.
   */
  role?: 'status' | 'alert';
}

export function StatePanel({ title, message, icon, action, titleAs = 'h2', role = 'status' }: StatePanelProps) {
  const TitleTag = titleAs;
  const ariaLive = role === 'alert' ? 'assertive' : 'polite';

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

  // The wrapper only carries a role/aria-live of its own for the "alert" case
  // (a time-critical error that should interrupt immediately). The default
  // "status" case relies solely on the delayed sr-only region below — giving
  // the wrapper role="status" too would create two competing status regions
  // and make screen-reader announcements ambiguous/duplicated.
  const wrapperRole = role === 'alert' ? role : undefined;
  const wrapperAriaLive = role === 'alert' ? ariaLive : undefined;

  return (
    <div
      className="flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 my-4"
      role={wrapperRole}
      aria-live={wrapperAriaLive}
    >
      {icon && <div className="text-slate-400 mb-4" aria-hidden="true">{icon}</div>}
      <TitleTag className="text-lg font-semibold text-scs-ink mb-2">{title}</TitleTag>
      <p className="text-sm text-slate-600 max-w-sm mb-6">{message}</p>
      {action && <div>{action}</div>}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
