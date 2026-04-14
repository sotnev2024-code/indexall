'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { paymentsApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';
import { canActivateTrial } from '@/lib/permissions';
import Header from '@/components/layout/Header';

interface TariffConfig {
  id: number;
  plan_key: string;
  name: string;
  price: number;
  price_annual: number | null;
  description: string;
}

const FEATURES = [
  'Работа с листом спецификации',
  'Доступны каталоги производителей',
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

  useEffect(() => {
    paymentsApi.getPlans()
      .then(({ data }) => setConfigs(data || []))
      .catch(() => { /* keep defaults */ });
  }, []);

  const monthlyConfig = configs.find(c => c.plan_key === 'pro' || c.plan_key === 'base');
  const monthly = monthlyConfig?.price ?? 7990;
  const annual  = monthlyConfig?.price_annual ?? 79900;

  // Show trial card for logged-out users (lead them to sign up) or logged-in users who can activate it
  const trialUsed = !!(user as any)?.trialUsed;
  const trialAvailable = !user || canActivateTrial(user as any);
  const isLoggedOut = !user;

  async function handleActivateTrial() {
    // If not logged in, redirect to register — trial activation happens after sign up
    if (!user) {
      router.push('/auth/register');
      return;
    }
    setLoading('trial');
    try {
      const { data } = await paymentsApi.activateTrial();
      const token = localStorage.getItem('token') || '';
      if (data?.user) setAuth(data.user, token);
      toast.success('Пробный период активирован на 7 дней');
      router.push('/projects');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось активировать пробный период');
    } finally {
      setLoading(null);
    }
  }

  async function handleBuy(plan: 'monthly' | 'annual') {
    // If not logged in, send to login first — purchase happens after auth
    if (!user) {
      router.push('/auth/login?redirect=/pricing');
      return;
    }
    setLoading(plan);
    try {
      const { data } = await paymentsApi.createPayment(plan, window.location.origin + '/projects');
      if (data?.confirmationUrl) {
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
            Активируйте бесплатный пробный период на 7 дней или оформите тариф.
          </p>
        </div>

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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 800 }}>{fmt(monthly)} ₽<span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>/месяц</span></span>
              <button
                onClick={() => handleBuy('monthly')}
                disabled={loading === 'monthly'}
                style={{ padding: '10px 22px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                {loading === 'monthly' ? '...' : 'Купить'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 12, marginTop: 6 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{fmt(annual)} ₽<span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>/год</span></div>
                <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>Экономия {fmt(monthly * 12 - annual)} ₽</div>
              </div>
              <button
                onClick={() => handleBuy('annual')}
                disabled={loading === 'annual'}
                style={{ padding: '10px 22px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                {loading === 'annual' ? '...' : 'Купить'}
              </button>
            </div>
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
      </main>
    </div>
  );
}
