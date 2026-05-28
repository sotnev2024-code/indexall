'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { paymentsApi, authApi, activityApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';
import { canActivateTrial, PAYMENTS_ENABLED } from '@/lib/permissions';
import Header from '@/components/layout/Header';
import PricingTilesGrid from '@/components/PricingTilesGrid';
import { usePageTracker } from '@/hooks/usePageTracker';

interface TariffConfig {
  id: number;
  plan_key: string;
  name: string;
  price: number;
  price_annual: number | null;
  duration_value: number;
  duration_unit: 'day' | 'month';
  description: string;
  sort_order?: number;
  width?: number;
  height?: number;
  parent_id?: number | null;
  image_path?: string | null;
}

function durationLabel(t: TariffConfig): string {
  const v = Number(t.duration_value);
  if (t.duration_unit === 'month') {
    if (v === 1) return '/месяц';
    if (v === 12) return '/год';
    return `/${v} мес`;
  }
  // day
  if (v === 30) return '/месяц';
  if (v === 365) return '/год';
  if (v === 7) return '/неделя';
  return `/${v} дн`;
}

const PAID_FEATURES = [
  'Работа с листом спецификации',
  'Доступны прайс-листы производителей',
  'Интеграция с онлайн-магазинами и актуализация цен',
  'Применение шаблонов',
  'Создание и работа с проектами',
  'Подбор аналогов оборудования',
  'Подбор аксессуаров',
];

function fmt(n: number) {
  return Number(n).toLocaleString('ru-RU');
}

// Success toast is triggered here — needs Suspense because of useSearchParams
function SuccessHandler() {
  const searchParams = useSearchParams();
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    if (!handled && searchParams.get('success') === '1') {
      toast.success('Оплата прошла успешно! Тариф активирован.');
      setHandled(true);
    }
  }, [searchParams, handled]);

  return null;
}

function PricingContent() {
  const router = useRouter();
  const { user, setAuth } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [tariffs, setTariffs] = useState<TariffConfig[]>([]);
  const [tilesMode, setTilesMode] = useState(false);
  const [myActivations, setMyActivations] = useState<Record<string, number>>({});

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    paymentsApi.getPlans().then(({ data }) => {
      const list = (data as TariffConfig[])
        .slice()
        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
      setTariffs(list);
    }).catch(() => {});
    paymentsApi.getPublicSettings()
      .then(({ data }) => setTilesMode(!!data?.pricingTilesEnabled))
      .catch(() => setTilesMode(false));
  }, []);

  // Load per-user activation counts when user is logged in
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || !user) return;
    paymentsApi.getMyActivations()
      .then(({ data }) => setMyActivations(data || {}))
      .catch(() => {});
  }, [user]);

  async function handleBuy(planKey: string) {
    if (!mounted) return;
    const token = localStorage.getItem('token');
    if (!token) { router.push('/auth/login?redirect=/pricing'); return; }

    activityApi.logEvent('click_tariff', `Нажал на тариф: ${planKey}`).catch(() => {});

    // Legacy trial plan_key — delegate to the existing trial endpoint
    if (planKey === 'trial') {
      handleActivateTrial();
      return;
    }

    // Check if this is a free tariff (price = 0) — activate without YooKassa
    const tariff = tariffs.find(t => t.plan_key === planKey);
    if (tariff && Number(tariff.price) === 0) {
      setLoading(planKey);
      try {
        await paymentsApi.activateFree(planKey);
        // Refresh user data and activation counts
        const [{ data: freshUser }, { data: acts }] = await Promise.all([
          authApi.me(),
          paymentsApi.getMyActivations(),
        ]);
        if (freshUser?.id) setAuth(freshUser, token);
        setMyActivations(acts || {});
        toast.success('Тариф активирован!');
        router.push('/projects');
      } catch (e: any) {
        toast.error(e?.response?.data?.message || 'Ошибка активации тарифа');
      } finally {
        setLoading(null);
      }
      return;
    }

    // Paid tariff → YooKassa
    if (!PAYMENTS_ENABLED) {
      toast('Оплата временно недоступна. Свяжитесь с поддержкой для активации тарифа.', { duration: 5000 });
      return;
    }
    setLoading(planKey);
    try {
      const returnUrl = `${window.location.origin}/profile?success=1`;
      const { data } = await paymentsApi.createPayment(planKey, returnUrl);
      if (data.confirmationUrl) {
        if (data.paymentId) localStorage.setItem('lastPaymentId', data.paymentId);
        window.location.href = data.confirmationUrl;
      } else {
        toast.error('YooKassa не вернул ссылку для оплаты');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Ошибка создания платежа');
    } finally {
      setLoading(null);
    }
  }

  async function handleActivateTrial() {
    if (!mounted) return;
    const token = localStorage.getItem('token');
    if (!token) { router.push('/auth/login?redirect=/pricing'); return; }
    setLoading('trial');
    try {
      // Backend returns the updated user directly (plan='trial' + subscriptionExpiresAt).
      // Push it into the store immediately so Header/Profile show the new tariff
      // without requiring a logout/login cycle.
      const { data } = await paymentsApi.activateTrial();
      if (data?.id) setAuth(data, token);
      toast.success('Пробный тариф активирован на 7 дней!');
      router.push('/projects');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка активации пробного тарифа');
    } finally {
      setLoading(null);
    }
  }

  usePageTracker('Тарифы');

  const plan = user?.plan;
  const trialUsed = (user as any)?.trialUsed ?? false;
  const expiresAt = (user as any)?.subscriptionExpiresAt;
  const isCurrentTrial = plan === 'trial';
  const isCurrentPro   = plan === 'base' || plan === 'pro' || plan === 'admin';
  const trialAvailable = canActivateTrial(user as any);
  const showTrialBtn = !user || trialAvailable;

  // Paid tariffs for the non-tiles (list) mode
  const paidTariffs = tariffs.filter(t => t.plan_key !== 'trial' && Number(t.price) > 0);

  // In tiles mode: show all active tariffs in their admin-configured positions.
  // Hide a tile if the user has reached its max_activations_per_user limit.
  const tileModeTariffs = tariffs.filter(t => {
    // Legacy trial plan: hide once used
    if (t.plan_key === 'trial') return !user || !trialUsed;
    // Generic limit: hide if user exhausted allowed activations
    const maxAct = Number((t as any).max_activations_per_user) || 0;
    if (maxAct > 0 && user) {
      const used = myActivations[t.plan_key] || 0;
      if (used >= maxAct) return false;
    }
    return true;
  });

  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f4' }}>
      <Header breadcrumb="Тарифы" />

      <main style={{ padding: '72px 24px 48px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <h1 style={{ textAlign: 'center', fontSize: 28, fontWeight: 800, marginBottom: 40, letterSpacing: -0.5 }}>
          Выберите тариф
        </h1>

        {tilesMode ? (
          /* Tiles mode: all tariffs (including trial) sit in their admin positions */
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PricingTilesGrid
              tariffs={tileModeTariffs as any}
              loadingPlanKey={loading}
              onBuy={handleBuy}
            />
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: showTrialBtn || isCurrentTrial ? '1fr 1fr' : '1fr', gap: 20, maxWidth: showTrialBtn || isCurrentTrial ? 760 : 380, margin: '0 auto' }}>

          {/* ── Paid tariffs card (lists every active paid tariff from admin) ── */}
          <div style={{
            background: '#fff', borderRadius: 14, padding: 28,
            border: isCurrentPro ? '2px solid #1a1a1a' : '1px solid #d0d0d0',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 19, fontWeight: 800 }}>Платные тарифы</h2>
              <span style={{ background: '#f5c800', borderRadius: 4, padding: '3px 10px', fontSize: 10, fontWeight: 700 }}>Все функции</span>
            </div>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 14, lineHeight: 1.5 }}>
              Полный доступ ко всем возможностям сервиса.
            </p>
            <div style={{ flex: 1, marginBottom: 18 }}>
              {PAID_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: '#10b981', marginTop: 1, flexShrink: 0 }}>•</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>

            {isCurrentPro && expiresAt && (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: 12, color: '#166534' }}>
                Активен до {new Date(expiresAt).toLocaleDateString('ru-RU')}
              </div>
            )}

            {paidTariffs.length === 0 && (
              <div style={{ padding: 12, color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
                Платных тарифов пока нет. Свяжитесь с администратором.
              </div>
            )}
            {paidTariffs.map((t, idx) => (
              <div
                key={t.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: idx < paidTariffs.length - 1 ? 12 : 0,
                  paddingTop: idx > 0 ? 12 : 0,
                  borderTop: idx > 0 ? '1px solid #f0f0f0' : 'none',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 2 }}>{t.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {fmt(Number(t.price))} ₽<span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280' }}>{durationLabel(t)}</span>
                  </div>
                </div>
                <button
                  style={{ padding: '10px 22px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                  onClick={() => handleBuy(t.plan_key)}
                  disabled={loading === t.plan_key}
                >
                  {loading === t.plan_key ? '...' : isCurrentPro ? 'Продлить' : 'Купить'}
                </button>
              </div>
            ))}
          </div>

          {/* ── Card 2: Trial — only when available ── */}
          {(showTrialBtn || isCurrentTrial) && (
            <div style={{
              background: '#fff', borderRadius: 14, padding: 28,
              border: isCurrentTrial ? '2px solid #f5c800' : '1px solid #e5e7eb',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: 19, fontWeight: 800 }}>Пробный</h2>
                <span style={{ background: '#f5c800', borderRadius: 4, padding: '3px 10px', fontSize: 10, fontWeight: 700 }}>7 дней</span>
              </div>
              <p style={{ fontSize: 12, color: '#666', marginBottom: 14, lineHeight: 1.5 }}>
                7 дней полного доступа ко всем возможностям, бесплатно.
              </p>
              <div style={{ flex: 1, marginBottom: 18 }}>
                {PAID_FEATURES.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, fontSize: 13 }}>
                    <span style={{ color: '#10b981', marginTop: 1, flexShrink: 0 }}>•</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              {isCurrentTrial ? (
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#059669' }}>✓ Trial активен</span>
                  {expiresAt && (
                    <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                      До {new Date(expiresAt).toLocaleDateString('ru-RU')}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 26, fontWeight: 800, textAlign: 'center', marginBottom: 12 }}>0 ₽</div>
                  <button
                    style={{ width: '100%', padding: '12px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
                    onClick={handleActivateTrial}
                    disabled={loading === 'trial'}
                  >
                    {loading === 'trial' ? 'Активация…' : 'Оформить'}
                  </button>
                  <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
                    Только один раз, бесплатно
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        )}

        {(isCurrentPro || isCurrentTrial) && (
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <button
              className="btn-outline"
              onClick={() => router.push('/projects')}
              style={{ fontSize: 13 }}
            >
              ← Вернуться к проектам
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default function PricingPage() {
  return (
    <>
      <Suspense fallback={null}>
        <SuccessHandler />
      </Suspense>
      <PricingContent />
    </>
  );
}
