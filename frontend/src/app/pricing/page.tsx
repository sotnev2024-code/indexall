'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { paymentsApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';
import { canActivateTrial, PAYMENTS_ENABLED } from '@/lib/permissions';
import Header from '@/components/layout/Header';

interface TariffConfig {
  id: number;
  plan_key: string;
  name: string;
  price: number;
  price_annual: number | null;
  description: string;
}

const PAID_FEATURES = [
  'Работа с листом спецификации',
  'Доступны каталоги производителей',
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
  const { user } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<string, TariffConfig>>({});

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    paymentsApi.getPlans().then(({ data }) => {
      const map: Record<string, TariffConfig> = {};
      data.forEach((p: TariffConfig) => { map[p.plan_key] = p; });
      setPlans(map);
    }).catch(() => {});
  }, []);

  async function handleBuy(planType: 'monthly' | 'annual') {
    if (!mounted) return;
    if (!PAYMENTS_ENABLED) {
      toast('Оплата временно недоступна. Свяжитесь с поддержкой для активации тарифа.', { duration: 5000 });
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) { router.push('/auth/login'); return; }
    setLoading(planType);
    try {
      const returnUrl = `${window.location.origin}/profile?success=1`;
      const { data } = await paymentsApi.createPayment(planType, returnUrl);
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
      await paymentsApi.activateTrial();
      toast.success('Пробный тариф активирован на 7 дней!');
      router.push('/projects');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка активации пробного тарифа');
    } finally {
      setLoading(null);
    }
  }

  const plan = user?.plan;
  const trialUsed = (user as any)?.trialUsed ?? false;
  const expiresAt = (user as any)?.subscriptionExpiresAt;
  const isCurrentTrial = plan === 'trial';
  const isCurrentPro   = plan === 'base' || plan === 'pro' || plan === 'admin';
  const trialAvailable = canActivateTrial(user as any);
  const showTrialBtn = !user || trialAvailable;

  const proPlan = plans.pro || plans.base;
  const monthlyPrice = proPlan?.price ?? 7990;
  const annualPrice  = proPlan?.price_annual ?? 79900;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f4' }}>
      <Header breadcrumb="Тарифы" />

      <main style={{ padding: '72px 24px 48px', maxWidth: 880, margin: '0 auto', width: '100%' }}>
        <h1 style={{ textAlign: 'center', fontSize: 28, fontWeight: 800, marginBottom: 16, letterSpacing: -0.5 }}>
          Выберите тариф
        </h1>
        <p style={{ textAlign: 'center', fontSize: 14, color: '#6b7280', maxWidth: 580, margin: '0 auto 40px' }}>
          Активируйте бесплатный пробный период на 7 дней или оформите тариф «Базовый».
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: showTrialBtn || isCurrentTrial ? '1fr 1fr' : '1fr', gap: 20, maxWidth: showTrialBtn || isCurrentTrial ? 760 : 380, margin: '0 auto' }}>

          {/* ── Card 1: Базовый (PRO) ── */}
          <div style={{
            background: '#fff', borderRadius: 14, padding: 28,
            border: isCurrentPro ? '2px solid #1a1a1a' : '1px solid #d0d0d0',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 19, fontWeight: 800 }}>Базовый</h2>
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

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>
                {fmt(monthlyPrice)} ₽<span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280' }}>/месяц</span>
              </div>
              <button
                style={{ padding: '10px 22px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                onClick={() => handleBuy('monthly')}
                disabled={loading === 'monthly'}
              >
                {loading === 'monthly' ? '...' : isCurrentPro ? 'Продлить' : 'Купить'}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {fmt(annualPrice)} ₽<span style={{ fontWeight: 400, fontSize: 11, color: '#6b7280' }}>/год</span>
                </div>
                <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>
                  Экономия {fmt(monthlyPrice * 12 - annualPrice)} ₽
                </div>
              </div>
              <button
                style={{ padding: '10px 22px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                onClick={() => handleBuy('annual')}
                disabled={loading === 'annual'}
              >
                {loading === 'annual' ? '...' : isCurrentPro ? 'Продлить' : 'Купить'}
              </button>
            </div>
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
