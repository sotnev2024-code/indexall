'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import Header from '@/components/layout/Header';
import { authApi, profileApi, paymentsApi, storesApi } from '@/lib/api';
import { useAppStore } from '@/store/app.store';

// ── helpers ──────────────────────────────────────────────────

function daysRemaining(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function planLabel(plan: string): string {
  switch (plan) {
    case 'free':   return 'Без подписки';
    case 'trial':  return 'Пробный (7 дней)';
    case 'base':
    case 'pro':    return 'Базовый';
    case 'admin':  return 'Администратор';
    default:       return 'Без подписки';
  }
}

function planColor(plan: string): string {
  switch (plan) {
    case 'base':
    case 'pro':    return '#059669';
    case 'trial':  return '#d97706';
    case 'admin':  return '#7c3aed';
    default:       return '#6b7280';
  }
}

// ── success banner — polls payment status and refreshes user ──

function SuccessBanner({ onRefresh }: { onRefresh: () => void }) {
  const sp = useSearchParams();
  const [shown, setShown] = useState(false);
  const [activating, setActivating] = useState(false);
  const polledRef = useRef(false);

  useEffect(() => {
    if (sp.get('success') !== '1' || polledRef.current) return;
    polledRef.current = true;
    setShown(true);

    const paymentId = sp.get('paymentId') || localStorage.getItem('lastPaymentId');
    if (!paymentId) {
      setTimeout(() => onRefresh(), 2000);
      return;
    }

    setActivating(true);
    let attempts = 0;
    const maxAttempts = 10;

    const poll = async () => {
      attempts++;
      try {
        const { data } = await paymentsApi.confirmPayment(paymentId);
        if (data.activated) {
          await onRefresh();
          setActivating(false);
          localStorage.removeItem('lastPaymentId');
          return;
        }
      } catch {}
      if (attempts < maxAttempts) {
        setTimeout(poll, 2000);
      } else {
        await onRefresh();
        setActivating(false);
      }
    };
    setTimeout(poll, 1500);
  }, [sp, onRefresh]);

  if (!shown) return null;
  return (
    <div style={{
      background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8,
      padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#166534',
      fontWeight: 600,
    }}>
      {activating
        ? 'Активация тарифа...'
        : 'Оплата прошла успешно! Тариф активирован.'}
    </div>
  );
}

// ── main page ────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const { user, setAuth } = useAppStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [payLoading, setPayLoading] = useState<string | null>(null);
  const [prices, setPrices] = useState<{ monthly: number; annual: number }>({ monthly: 0, annual: 0 });

  // ETM credentials
  const [etmLogin, setEtmLogin] = useState('');
  const [etmPassword, setEtmPassword] = useState('');
  const [etmSaved, setEtmSaved] = useState(false);
  const [etmLoading, setEtmLoading] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const { data } = await authApi.me();
      setAuth(data, token);
    } catch {}
  }, [setAuth]);

  // Hydrate form from store/API
  useEffect(() => {
    if (!user) return;
    setName(user.name || '');
    setEmail(user.email || '');
  }, [user]);

  useEffect(() => {
    paymentsApi.getPlans().then(({ data }) => {
      const pro = data.find((p: any) => p.plan_key === 'pro');
      if (pro) setPrices({ monthly: Number(pro.price), annual: Number(pro.price_annual) || 0 });
    }).catch(() => {});
  }, []);

  // If no token — redirect
  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
      router.replace('/auth/login');
    }
  }, [router]);

  // Load ETM credentials status
  useEffect(() => {
    storesApi.getEtmCredentials().then(({ data }) => {
      if (data?.login) { setEtmLogin(data.login); setEtmSaved(true); }
    }).catch(() => {});
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const { data } = await profileApi.updateProfile({ name: name.trim(), email: email.trim() });
      // Refresh store
      const me = await authApi.me();
      setAuth(me.data, localStorage.getItem('token') || '');
      toast.success('Профиль сохранён');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Ошибка сохранения профиля');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== newPassword2) {
      toast.error('Новые пароли не совпадают');
      return;
    }
    setSavingPassword(true);
    try {
      await profileApi.changePassword({ oldPassword, newPassword });
      toast.success('Пароль изменён');
      setOldPassword(''); setNewPassword(''); setNewPassword2('');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Ошибка смены пароля');
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleRenew(planType: 'monthly' | 'annual') {
    setPayLoading(planType);
    try {
      const returnUrl = `${window.location.origin}/profile?success=1`;
      const { data } = await paymentsApi.createPayment(planType, returnUrl);
      if (data.confirmationUrl) {
        if (data.paymentId) localStorage.setItem('lastPaymentId', data.paymentId);
        window.location.href = data.confirmationUrl;
      } else {
        toast.error('Не удалось создать платёж');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Ошибка создания платежа');
    } finally {
      setPayLoading(null);
    }
  }

  async function handleSaveEtm(e: React.FormEvent) {
    e.preventDefault();
    if (!etmLogin.trim() || !etmPassword.trim()) { toast.error('Введите логин и пароль'); return; }
    setEtmLoading(true);
    try {
      await storesApi.saveEtmCredentials(etmLogin.trim(), etmPassword.trim());
      setEtmSaved(true);
      setEtmPassword('');
      toast.success('Данные ЭТМ сохранены');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Ошибка сохранения');
    } finally { setEtmLoading(false); }
  }

  async function handleRemoveEtm() {
    if (!confirm('Удалить данные ЭТМ?')) return;
    setEtmLoading(true);
    try {
      await storesApi.removeEtmCredentials();
      setEtmLogin(''); setEtmPassword(''); setEtmSaved(false);
      toast.success('Данные ЭТМ удалены');
    } catch { toast.error('Ошибка'); } finally { setEtmLoading(false); }
  }

  const plan = user?.plan || 'free';
  const expiresAt = user?.subscriptionExpiresAt;
  const days = daysRemaining(expiresAt);
  const subscriptionActive = !!expiresAt && new Date(expiresAt).getTime() > Date.now();
  const isBase  = (plan === 'base' || plan === 'pro') && subscriptionActive;
  const isTrial = plan === 'trial' && subscriptionActive;
  const isFree  = !subscriptionActive && plan !== 'admin';

  // ── Subscription block ──────────────────────────────────────
  const subscriptionBlock = (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid #e5e7eb' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Подписка</h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{
          background: planColor(plan) + '1a', color: planColor(plan),
          borderRadius: 6, padding: '4px 12px', fontWeight: 700, fontSize: 13,
        }}>
          {planLabel(plan)}
        </span>
        {(isBase || isTrial) && expiresAt && (
          <span style={{ fontSize: 13, color: days !== null && days <= 7 ? '#dc2626' : '#374151' }}>
            {days !== null && days > 0
              ? `Осталось ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}`
              : 'Срок истёк'}
            {' · до '}{new Date(expiresAt).toLocaleDateString('ru-RU')}
          </span>
        )}
      </div>

      {isBase && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleRenew('monthly')}
            disabled={payLoading === 'monthly'}
            style={{ padding: '8px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: payLoading === 'monthly' ? 0.6 : 1 }}
          >
            {payLoading === 'monthly' ? '...' : `Продлить на месяц — ${prices.monthly ? prices.monthly.toLocaleString('ru-RU') + ' ₽' : '...'}`}
          </button>
          {prices.annual > 0 && (
            <button
              onClick={() => handleRenew('annual')}
              disabled={payLoading === 'annual'}
              style={{ padding: '8px 18px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: payLoading === 'annual' ? 0.6 : 1 }}
            >
              {payLoading === 'annual' ? '...' : `Продлить на год — ${prices.annual.toLocaleString('ru-RU')} ₽`}
            </button>
          )}
        </div>
      )}

      {isTrial && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            После окончания пробного периода доступ к функциям прекратится. Оформите подписку, чтобы продолжить работу.
          </p>
          <button
            onClick={() => router.push('/pricing')}
            style={{ alignSelf: 'flex-start', padding: '8px 18px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Купить подписку
          </button>
        </div>
      )}

      {isFree && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            Обновите тариф, чтобы получить доступ ко всем функциям.
          </p>
          <button
            onClick={() => router.push('/pricing')}
            style={{ alignSelf: 'flex-start', padding: '8px 18px', background: '#f5c800', color: '#1a1a1a', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Перейти к тарифам
          </button>
        </div>
      )}
    </div>
  );

  // ── Profile form ────────────────────────────────────────────
  const profileForm = (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid #e5e7eb' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Данные профиля</h2>
      <form onSubmit={handleSaveProfile}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Имя</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="input-field"
              placeholder="Иван Иванов"
              required
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-field"
              placeholder="name@example.com"
              required
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={savingProfile}
          style={{ padding: '8px 20px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: savingProfile ? 0.6 : 1 }}
        >
          {savingProfile ? 'Сохранение…' : 'Сохранить изменения'}
        </button>
      </form>
    </div>
  );

  // ── Password form ───────────────────────────────────────────
  const passwordForm = (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Изменить пароль</h2>
      <form onSubmit={handleChangePassword}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Текущий пароль</label>
            <input
              type="password"
              value={oldPassword}
              onChange={e => setOldPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              required
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Новый пароль</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Повторите новый пароль</label>
              <input
                type="password"
                value={newPassword2}
                onChange={e => setNewPassword2(e.target.value)}
                className="input-field"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
          </div>
        </div>
        <button
          type="submit"
          disabled={savingPassword}
          style={{ padding: '8px 20px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: savingPassword ? 0.6 : 1 }}
        >
          {savingPassword ? 'Сохранение…' : 'Изменить пароль'}
        </button>
      </form>
    </div>
  );

  return (
    <>
      <Header breadcrumb="Профиль" />
      <div style={{ maxWidth: 720, margin: '72px auto 40px', padding: '0 20px' }}>
        <Suspense fallback={null}>
          <SuccessBanner onRefresh={refreshUser} />
        </Suspense>
        {subscriptionBlock}
        {profileForm}
        {passwordForm}

        {/* ETM integration */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, marginTop: 20, border: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Интеграция с ЭТМ</h2>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
            Логин и пароль от личного кабинета ЭТМ iPRO. Используются для получения цен в спецификации.
          </p>
          {etmSaved && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontSize: 13 }}>
              <span style={{ color: '#166534', fontWeight: 600 }}>Подключено: {etmLogin}</span>
              <button onClick={handleRemoveEtm} disabled={etmLoading} style={{ marginLeft: 'auto', padding: '4px 12px', background: 'transparent', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                Отключить
              </button>
            </div>
          )}
          <form onSubmit={handleSaveEtm}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Логин ЭТМ</label>
                <input value={etmLogin} onChange={e => setEtmLogin(e.target.value)} className="input-field" placeholder="login@etm.ru" autoComplete="off" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{etmSaved ? 'Новый пароль (оставьте пустым чтобы не менять)' : 'Пароль ЭТМ'}</label>
                <input type="password" value={etmPassword} onChange={e => setEtmPassword(e.target.value)} className="input-field" placeholder="••••••••" autoComplete="new-password" />
              </div>
            </div>
            <button type="submit" disabled={etmLoading} style={{ padding: '8px 20px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: etmLoading ? 0.6 : 1 }}>
              {etmLoading ? 'Сохранение…' : 'Сохранить'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
