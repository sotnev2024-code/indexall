/**
 * Plan-based permission system.
 *
 * Plans: free | trial | base | pro | admin
 *
 * free  — view-only. Can browse specs and manufacturer catalogs.
 *          No editing, inserting, deleting. No store integration.
 * trial — full access for 7 days (free, one-time, from free plan only)
 * base  — full access (monthly or annual subscription)
 * pro   — full access (legacy, same as base)
 * admin — full access + admin panel
 */

type Plan = string | null | undefined;

const PAID_PLANS = new Set(['trial', 'base', 'pro', 'admin']);

/** Whether the user can edit content (insert, delete, modify rows) */
export function canEdit(plan: Plan): boolean {
  return PAID_PLANS.has(plan ?? '');
}

/** Whether the user can use store price integration */
export function canUseStores(plan: Plan): boolean {
  return PAID_PLANS.has(plan ?? '');
}

/** Whether the user can create/edit/delete projects */
export function canManageProjects(plan: Plan): boolean {
  return PAID_PLANS.has(plan ?? '');
}

/** Whether the user can apply or create templates */
export function canUseTemplates(plan: Plan): boolean {
  return PAID_PLANS.has(plan ?? '');
}

/** Whether the user can activate the free trial */
export function canActivateTrial(plan: Plan, trialUsed: boolean): boolean {
  return plan === 'free' && !trialUsed;
}

/** Display label for a plan */
export function planDisplayName(plan: Plan): string {
  switch (plan) {
    case 'free':   return 'Бесплатный';
    case 'trial':  return 'Пробный (Trial)';
    case 'base':   return 'Базовый';
    case 'pro':    return 'Базовый';
    case 'admin':  return 'Администратор';
    default:       return 'Бесплатный';
  }
}

/** Returns true if user is on a free (restricted) plan */
export function isFree(plan: Plan): boolean {
  return !plan || plan === 'free';
}
