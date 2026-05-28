'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { paymentsApi, authApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';
import { canActivateTrial, PAYMENTS_ENABLED } from '@/lib/permissions';
import Header from '@/components/layout/Header';
import PricingTilesGrid from '@/components/PricingTilesGrid';

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
  max_activations_per_user?: number | null;
}

function durationLabel(t: TariffConfig): string {
  const v = Number(t.duration_value);
  if (t.duration_unit === 'month') {
    if (v === 1) return '/месяц';
    if (v === 12) return '/год';
    return `/${v} мес`;
  }
  if (v === 30) return '/месяц';
  if (v === 365) return '/год';
  if (v === 7) return '/неделя';
  return `/${v} дн`;
}

const FEATURES = [
  'Работа с листом спецификации',
  'Доступны прайс-листы производителей',
  'Интеграция с онлайн-магазинами и актуализация цен',
  'Применение шаблонов',
  'Создание и работа с проектами',
  'Подбор аналогов оборудования',
  'Подбор аксессуаров',
];

function fmt(n: number) { return Number(n).toLocaleString('ru-RU'); }

/**
 * Full-screen paywall shown to users without an active subscription.
 * Replaces the page content (projects, catalog, spec, etc.) until they subscribe.
 */
export default function PaywallScreen() {
  const router = useRouter();
  const { user, setAuth } = useAppStore();
  const [configs, setConfigs] = useState<TariffConfig[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [tilesMode, setTilesMode] = useState(false);
  const [myActivations, setMyActivations] = useState<Record<string, number>>({});

  useEffect(() => {
    paymentsApi.getPlans()
      .then(({ data }) => setConfigs(data || []))
      .catch(() => {});
    paymentsApi.getPublicSettings()
      .then(({ data }) => setTilesMode(!!data?.pricingTilesEnabled))
      .catch(() => setTilesMode(false));
  }, []);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || !user) return;
    paymentsApi.getMyActivations()
      .then(({ data }) => setMyActivations(data || {}))
      .catch(() => {});
  }, [user]);

  const trialUsed = !!(user as any)?.trialUsed;
  const trialAvailable = !user || canActivateTrial(user as any);
  const isLoggedOut = !user;

  const paidTariffs = configs
    .filter(c => c.plan_key !== 'trial' && Number(c.price) > 0)
    .slice()
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  // All tariffs for tiles mode (same logic as /pricing page)
  const tileModeTariffs = configs.filter(t => {
    if (t.plan_key === 'trial') return trialAvailable;
    const maxAct = Number(t.max_activations_per_user) || 0;
    if (maxAct > 0 && user) {
      const used = myActivations[t.plan_key] || 0;
      if (used >= maxAct) return false;
    }
    return true;
  });

  async function handleActivateTrial() {
    // If not logged in, redirect to register — trial activation happens after sign up
    if (!user) {
      router.push('/auth/register');
      return;
    }
    setLoading('trial');
    try {
      // Backend returns the updated user directly (not wrapped in { user: ... }) —
      // using data.user here used to silently drop the update, which is why the
      // new tariff only appeared after a logout/login cycle.
      const { data } = await paymentsApi.activateTrial();
      const token = localStorage.getItem('token') || '';
      if (data?.id) setAuth(data, token);
      toast.success('Пробный период активирован на 7 дней');
      router.push('/projects');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось активировать пробный период');
    } finally {
      setLoading(null);
    }
  }

  async function handleBuy(planKey: string) {
    // If trial key — delegate
    if (planKey === 'trial') {
      handleActivateTrial();
      return;
    }
    // If not logged in, send to login first
    if (!user) {
      router.push('/auth/login?redirect=/pricing');
      return;
    }
    // Free tariff (price = 0) — activate without YooKassa
    const tariff = configs.find(t => t.plan_key === planKey);
    if (tariff && Number(tariff.price) === 0) {
      setLoading(planKey);
      try {
        await paymentsApi.activateFree(planKey);
        const token = localStorage.getItem('token') || '';
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
    if (!PAYMENTS_ENABLED) {
      toast('Оплата временно недоступна. Свяжитесь с поддержкой для активации тарифа.', { duration: 5000 });
      return;
    }
    setLoading(planKey);
    try {
      const { data } = await paymentsApi.createPayment(planKey, window.location.origin + '/profile?success=1');
      if (data?.confirmationUrl) {
        if (data.paymentId) localStorage.setItem('lastPaymentId', data.paymentId);
        window.location.href = data.confirmationUrl;
      } else {
        toast.error('Не удалось получить ссылку оплаты');
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка создания платежа');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f4' }}>
      <Header breadcrumb="Оформление подписки" />
      <main style={{ padding: '72px 24px 48px', maxWidth: 980, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 10, letterSpacing: -0.5 }}>
            Оформите подписку, чтобы продолжить
          </h1>
          <p style={{ fontSize: 15, color: '#6b7280', maxWidth: 580, margin: '0 auto' }}>
            Для работы с проектами, каталогом и спецификациями необходима активная подписка.
          </p>
        </div>

        {tilesMode ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PricingTilesGrid
              tariffs={tileModeTariffs as any}
              loadingPlanKey={loading}
              onBuy={handleBuy}
            />
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: trialAvailable ? '1fr 1fr' : '1fr', gap: 20, maxWidth: trialAvailable ? 760 : 380, margin: '0 auto' }}>
          {/* Pro tariff */}
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, border: '2px solid #1a1a1a', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <h3 style={{ fontSize: 19, fontWeight: 800 }}>Профессиональный</h3>
              <span style={{ background: '#f5c800', color: '#1a1a1a', padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>Все функции</span>
            </div>
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>Полный доступ ко всем возможностям</p>
            <ul style={{ listStyle: 'none', padding: 0, marginBottom: 18 }}>
              {FEATURES.map(f => (
                <li key={f} style={{ fontSize: 13, padding: '4px 0', display: 'flex', gap: 8 }}>
                  <span style={{ color: '#10b981' }}>•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {paidTariffs.length === 0 && (
              <div style={{ padding: 12, color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
                Платных тарифов пока нет. Свяжитесь с администратором.
              </div>
            )}
            {paidTariffs.map((t, idx) => (
              <div
                key={t.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  paddingTop: idx > 0 ? 12 : 0,
                  marginTop: idx > 0 ? 6 : 0,
                  marginBottom: idx < paidTariffs.length - 1 ? 0 : 0,
                  borderTop: idx > 0 ? '1px solid #f0f0f0' : 'none',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 2 }}>{t.name}</div>
                  <span style={{ fontSize: 22, fontWeight: 800 }}>
                    {fmt(Number(t.price))} ₽
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>{durationLabel(t)}</span>
                  </span>
                </div>
                <button
                  onClick={() => handleBuy(t.plan_key)}
                  disabled={loading === t.plan_key}
                  style={{ padding: '10px 22px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  {loading === t.plan_key ? '...' : 'Купить'}
                </button>
              </div>
            ))}
          </div>

          {/* Trial */}
          {trialAvailable && (
            <div style={{ background: '#fff', borderRadius: 14, padding: 28, border: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 style={{ fontSize: 19, fontWeight: 800 }}>Пробный</h3>
                <span style={{ background: '#f5c800', color: '#1a1a1a', padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>7 дней</span>
              </div>
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>7 дней бесплатного Pro</p>
              <ul style={{ listStyle: 'none', padding: 0, marginBottom: 18 }}>
                {FEATURES.map(f => (
                  <li key={f} style={{ fontSize: 13, padding: '4px 0', display: 'flex', gap: 8 }}>
                    <span style={{ color: '#10b981' }}>•</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 26, fontWeight: 800 }}>0 ₽</span>
              </div>
              <button
                onClick={handleActivateTrial}
                disabled={loading === 'trial'}
                style={{ width: '100%', padding: '12px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                {loading === 'trial' ? '...' : (isLoggedOut ? 'Зарегистрироваться' : 'Оформить')}
              </button>
              <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
                {isLoggedOut ? 'Создайте аккаунт и получите 7 дней Pro' : 'Только один раз, бесплатно'}
              </p>
            </div>
          )}
        </div>
        )}
      </main>
    </div>
  );
}
