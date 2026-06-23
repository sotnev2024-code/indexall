'use client';
import { useEffect, useRef, useState } from 'react';
import { paymentsApi } from '@/lib/api';
import type { OnboardingSlide } from '@/lib/api';
import OnboardingSlidesModal from './OnboardingSlidesModal';

const seenKey = (section: string) => `onboardingSeen_${section}`;

/**
 * Drops a one-time onboarding for a given app section (spec / catalog /
 * projects / templates). Shown to ANY user the first time they enter the
 * section, once per device. Waits if the welcome («Супер!») modal is open so
 * the two never overlap — re-checks on the `welcome-dismissed` event.
 */
export default function SectionOnboarding({ section }: { section: string }) {
  const [slides, setSlides] = useState<OnboardingSlide[] | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function tryStart() {
      if (startedRef.current || cancelled) return;
      try { if (localStorage.getItem(seenKey(section))) return; } catch {}
      // Don't clash with the trial welcome modal — wait for its dismissal.
      if (typeof document !== 'undefined' && document.body.dataset.welcomeOpen === '1') return;
      startedRef.current = true;
      paymentsApi.getPublicSettings()
        .then(({ data }) => {
          if (cancelled) return;
          const list = (data?.onboarding || {})[section] || [];
          if (list.length > 0) setSlides(list);
        })
        .catch(() => { startedRef.current = false; });
    }

    // Small delay so the welcome modal (if any) has time to mark itself open.
    timer = setTimeout(tryStart, 800);
    const onWelcomeDismissed = () => tryStart();
    window.addEventListener('welcome-dismissed', onWelcomeDismissed);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('welcome-dismissed', onWelcomeDismissed);
    };
  }, [section]);

  if (!slides) return null;
  return (
    <OnboardingSlidesModal
      slides={slides}
      onClose={() => {
        setSlides(null);
        try { localStorage.setItem(seenKey(section), '1'); } catch {}
      }}
    />
  );
}
