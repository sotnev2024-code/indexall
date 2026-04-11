'use client';
import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/app.store';
import { hasActiveSubscription } from '@/lib/permissions';
import PaywallScreen from './PaywallScreen';

/**
 * Wraps a page so it shows the paywall when the current user has no active subscription.
 * Waits for auth hydration before deciding to avoid a flash on initial load.
 */
export default function RequireSubscription({ children }: { children: React.ReactNode }) {
  const { user } = useAppStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Allow store to hydrate from localStorage on the client
    const t = setTimeout(() => setHydrated(true), 30);
    return () => clearTimeout(t);
  }, []);

  if (!hydrated) return null;
  if (!hasActiveSubscription(user as any)) return <PaywallScreen />;
  return <>{children}</>;
}
