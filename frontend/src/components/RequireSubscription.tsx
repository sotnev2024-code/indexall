'use client';
import { useAppStore } from '@/store/app.store';
import { hasActiveSubscription } from '@/lib/permissions';
import PaywallScreen from './PaywallScreen';

/**
 * Wraps a page so it shows the paywall when the current user has no active
 * subscription. Blocks rendering until AuthHydrator finishes its /auth/me
 * refresh — otherwise a stale cached user (e.g. after admin plan change)
 * flashes the paywall before the fresh plan arrives.
 */
export default function RequireSubscription({ children }: { children: React.ReactNode }) {
  const { user, authReady } = useAppStore();
  if (!authReady) return null;
  if (!hasActiveSubscription(user as any)) return <PaywallScreen />;
  return <>{children}</>;
}
