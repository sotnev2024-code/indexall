/**
 * Plan-based permission system.
 *
 * Plans: trial | base | pro | admin (free legacy → treated as no subscription)
 *
 * Active subscription = paid plan AND (admin OR subscriptionExpiresAt in the future).
 * Without an active subscription a user sees only the paywall screen.
 */

type Plan = string | null | undefined;

const PAID_PLANS = new Set(['trial', 'base', 'pro', 'admin']);

/**
 * Feature flag: paid subscription purchase via YooKassa.
 * Currently disabled — test ЮKassa shop is configured, real payments would fail.
 * Set to `true` once the production ЮKassa shop credentials are deployed.
 */
export const PAYMENTS_ENABLED = false;

interface UserLike {
  plan?: string | null;
  subscriptionExpiresAt?: string | null;
}

/** Whether the user has an active paid (or trial) subscription right now */
export function hasActiveSubscription(user: UserLike | null | undefined): boolean {
  if (!user) return false;
  if (user.plan === 'admin') return true;
  if (!PAID_PLANS.has(user.plan ?? '')) return false;
  if (!user.subscriptionExpiresAt) return false;
  return new Date(user.subscriptionExpiresAt).getTime() > Date.now();
}

/** Whether the user can activate the free trial */
export function canActivateTrial(user: UserLike | null | undefined): boolean {
  if (!user) return false;
  return !hasActiveSubscription(user) && !(user as any).trialUsed;
}

// Legacy plan-only checks (kept so old call sites compile)
export function canEdit(_plan: Plan): boolean { return true; }
export function canUseStores(plan: Plan): boolean { return PAID_PLANS.has(plan ?? ''); }
export function canManageProjects(_plan: Plan): boolean { return true; }
export function canUseTemplates(plan: Plan): boolean { return PAID_PLANS.has(plan ?? ''); }
export function isPro(plan: Plan): boolean { return PAID_PLANS.has(plan ?? ''); }

/** Display label for a plan */
export function planDisplayName(plan: Plan): string {
  switch (plan) {
    case 'free':   return 'Без подписки';
    case 'trial':  return 'Пробный (Trial)';
    case 'base':
    case 'pro':    return 'Pro';
    case 'admin':  return 'Администратор';
    default:       return 'Без подписки';
  }
}

/** Returns true if user is on a free (restricted) plan */
export function isFree(plan: Plan): boolean {
  return !plan || plan === 'free';
}
