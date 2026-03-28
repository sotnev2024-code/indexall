'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { paymentsApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';
import { canActivateTrial } from '@/lib/permissions';

const FREE_FEATURES = [
  'Просмотр шаблонов и проектов',
  'Работа с листом спецификации',
  'Доступны каталоги производителей',
];

const PAID_FEATURES = [
  'Работа с листом спецификации',
  'Доступны каталоги производителей',
  'Интеграция с онлайн-магазинами и актуализация цен',
  'Применение шаблонов',
  'Создание и работа с проектами',
  'Подбор аналогов оборудования',
  'Подбор аксессуаров',
];

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

  useEffect(() => { setMounted(true); }, []);

  async function handleBuy(planType: 'monthly' | 'annual') {
    if (!mounted) return;
    const token = localStorage.getItem('token');
    if (!token) { router.push('/auth/login'); return; }
    setLoading(planType);
    try {
      const { data } = await paymentsApi.createPayment(planType);
      if (data.confirmationUrl) {
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
    if (!token) { router.push('/auth/login'); return; }
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
  const isCurrentFree  = !plan || plan === 'free';
  const isCurrentTrial = plan === 'trial';
  const isCurrentBase  = plan === 'base' || plan === 'pro' || plan === 'admin';
  const trialAvailable = canActivateTrial(plan, trialUsed);

  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f4', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        background: '#1a1a1a', color: '#fff',
        height: 48, display: 'flex', alignItems: 'center',
        padding: '0 20px', position: 'sticky', top: 0, zIndex: 100,
        gap: 12,
      }}>
        <div
          style={{ width: 34, height: 34, background: '#f5c800', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          onClick={() => router.push('/projects')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2.5" width="18" height="18">
            <polygon points="13,2 3,14 12,14 11,22 21,10 12,10" />
          </svg>
        </div>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>МЕНЮ</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#ccc' }}>{user?.name || user?.email?.split('@')[0] || 'User'}</span>
          <div style={{ width: 34, height: 34, background: '#f5c800', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2" width="18" height="18">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, padding: '48px 24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <h1 style={{ textAlign: 'center', fontSize: 28, fontWeight: 800, marginBottom: 48, letterSpacing: -0.5 }}>
          Выберите лучший тариф для Вас
        </h1>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>

          {/* ── Card 1: Бесплатный ── */}
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28,
            border: isCurrentFree ? '2px solid #1a1a1a' : '1px solid #d0d0d0',
            display: 'flex', flexDirection: 'column', gap: 0,
            boxShadow: isCurrentFree ? '0 2px 16px rgba(0,0,0,0.08)' : 'none',
          }}>
            <div style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800 }}>Бесплатный</h2>
            </div>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 20, lineHeight: 1.5 }}>
              Начните ускорять подбор оборудования и увеличивать количество обработанных заявок
            </p>
            <div style={{ flex: 1, marginBottom: 28 }}>
              {FREE_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, fontSize: 12 }}>
                  <span style={{ color: '#1a1a1a', marginTop: 1, flexShrink: 0 }}>•</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
            <button
              disabled
              style={{
                background: '#f4f4f4', border: '1px solid #d0d0d0', borderRadius: 8,
                padding: '10px 0', fontWeight: 700, fontSize: 13, cursor: 'default',
                width: '100%', color: '#1a1a1a',
              }}
            >
              {isCurrentFree ? 'Используется' : 'Базовый тариф'}
            </button>
          </div>

          {/* ── Card 2: Базовый ── */}
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28,
            border: isCurrentBase ? '2px solid #f5c800' : '1px solid #d0d0d0',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
          }}>
            <div style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800 }}>Базовый</h2>
            </div>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 20, lineHeight: 1.5 }}>
              Ускорение работы со спецификациями, ценами, аналогами, аксессуарами, шаблонами.
            </p>
            <div style={{ flex: 1, marginBottom: 20 }}>
              {PAID_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, fontSize: 12 }}>
                  <span style={{ color: '#1a1a1a', marginTop: 1, flexShrink: 0 }}>•</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>

            {/* Active subscription expiry */}
            {isCurrentBase && expiresAt && (
              <div style={{ marginBottom: 14, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: 12, color: '#166534' }}>
                Активен до {new Date(expiresAt).toLocaleDateString('ru-RU')}
              </div>
            )}

            {/* Monthly price */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                7 990 <span style={{ fontWeight: 400, fontSize: 13 }}>₽/месяц</span>
              </div>
              <button
                className="btn-primary"
                style={{ minWidth: 90, justifyContent: 'center' }}
                onClick={() => handleBuy('monthly')}
                disabled={loading === 'monthly'}
              >
                {loading === 'monthly' ? '...' : isCurrentBase ? 'Продлить' : 'Купить'}
              </button>
            </div>

            {/* Annual price */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #eee', paddingTop: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  79 900 <span style={{ fontWeight: 400, fontSize: 13 }}>₽/год</span>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Экономия 15 890 ₽</div>
              </div>
              <button
                className="btn-primary"
                style={{ minWidth: 90, justifyContent: 'center' }}
                onClick={() => handleBuy('annual')}
                disabled={loading === 'annual'}
              >
                {loading === 'annual' ? '...' : isCurrentBase ? 'Продлить' : 'Купить'}
              </button>
            </div>
          </div>

          {/* ── Card 3: Trial ── */}
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28,
            border: isCurrentTrial ? '2px solid #f5c800' : '1px solid #d0d0d0',
            display: 'flex', flexDirection: 'column',
            boxShadow: isCurrentTrial ? '0 2px 16px rgba(245,200,0,0.2)' : 'none',
          }}>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800 }}>Базовый пробный</h2>
              <span style={{ background: '#f5c800', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>7 дней</span>
            </div>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 20, lineHeight: 1.5 }}>
              7 дней работы на базовом тарифе без ограничения функционала. Бесплатно, только один раз.
            </p>
            <div style={{ flex: 1, marginBottom: 28 }}>
              {PAID_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, fontSize: 12 }}>
                  <span style={{ color: '#1a1a1a', marginTop: 1, flexShrink: 0 }}>•</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>

            {isCurrentTrial ? (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#059669' }}>✓ Пробный тариф активен</span>
                {expiresAt && (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    До {new Date(expiresAt).toLocaleDateString('ru-RU')}
                  </div>
                )}
              </div>
            ) : trialAvailable ? (
              <div>
                <div style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 10 }}>
                  <strong style={{ fontSize: 18, color: '#1a1a1a' }}>Бесплатно</strong>
                </div>
                <button
                  className="btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={handleActivateTrial}
                  disabled={loading === 'trial'}
                >
                  {loading === 'trial' ? 'Активация…' : 'Активировать бесплатно'}
                </button>
              </div>
            ) : trialUsed ? (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <span style={{ fontSize: 12, color: '#888' }}>Пробный период уже использован</span>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <span style={{ fontSize: 12, color: '#888' }}>Только для бесплатного тарифа</span>
              </div>
            )}
          </div>

        </div>

        {/* Back link */}
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <button
            className="btn-outline"
            onClick={() => router.push('/projects')}
            style={{ fontSize: 13 }}
          >
            ← Вернуться к проектам
          </button>
        </div>
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
