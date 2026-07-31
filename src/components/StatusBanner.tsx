import type { ReactNode } from 'react';
import Spinner from './Spinner';

interface Props {
  tone: 'success' | 'progress';
  children: ReactNode;
}

/** A persistent, unambiguous "here's what just happened" line — used at
 * every handshake/connection milestone so the user never has to guess
 * whether the other device has responded. */
export default function StatusBanner({ tone, children }: Props) {
  return (
    <div className={`status-banner status-${tone}`}>
      {tone === 'success' ? (
        <svg className="check-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.15" />
          <path d="M7 12.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <Spinner />
      )}
      <span>{children}</span>
    </div>
  );
}
