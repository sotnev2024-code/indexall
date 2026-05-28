import { useEffect, useRef } from 'react';
import { activityApi } from '@/lib/api';

/**
 * Tracks how long the user stays in a section.
 * Logs `open_section` on mount and `leave_section` on unmount.
 */
export function usePageTracker(section: string, details?: string) {
  const enteredAt = useRef<number>(Date.now());

  useEffect(() => {
    enteredAt.current = Date.now();
    activityApi.logEvent('open_section', details ? `${section}: ${details}` : section);

    return () => {
      const sec = Math.round((Date.now() - enteredAt.current) / 1000);
      const duration = sec >= 60
        ? `${Math.floor(sec / 60)}м ${sec % 60}с`
        : `${sec}с`;
      activityApi.logEvent('leave_section', `${section}, время: ${duration}`);
    };
  }, []);
}
