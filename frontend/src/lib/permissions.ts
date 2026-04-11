/**
 * Plan-based permission system.
 *
 * Plans: free | trial | pro | admin
 *
 * free  — can create projects, sheets and edit rows. Can browse manufacturer catalogs.
 *         CANNOT: save/load templates, use ETM price integration.
 * trial — full access for 7 days (free, one-time, from free plan only)
 * pro   — full access (monthly or annual subscription)
 * admin — full access + admin panel
 */

type Plan = string | null | undefined;

const PRO_PLANS = new Set(['trial', 'base', 'pro', 'admin']);

/** Whether the user can edit content (always true now — free can edit too) */
export function canEdit(_plan: Plan): boolean {
  return true;
}

/** Whether the user can use ETM price integration (PRO only) */
export function canUseStores(plan: Plan): boolean {
  return PRO_PLANS.has(plan ?? '');
}

/** Whether the user can create/edit/delete projects (always true now) */
export function canManageProjects(_plan: Plan): boolean {
  return true;
}

/** Whether the user can apply or create templates (PRO only) */
export function canUseTemplates(plan: Plan): boolean {
  return PRO_PLANS.has(plan ?? '');
}

/** Whether the user is on the PRO plan (or trial/admin) */
export function isPro(plan: Plan): boolean {
  return PRO_PLANS.has(plan ?? '');
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
    case 'base':
    case 'pro':    return 'Pro';
    case 'admin':  return 'Администратор';
    default:       return 'Бесплатный';
  }
}

/** Returns true if user is on a free (restricted) plan */
export function isFree(plan: Plan): boolean {
  return !plan || plan === 'free';
}
