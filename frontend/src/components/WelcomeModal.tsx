'use client';
import { useEffect, useState } from 'react';

interface WelcomeInfo {
  name: string;
  days: number;
}

/**
 * Shows once after a new user confirms their email and a free tariff is
 * auto-activated. Info is stored in localStorage by the /auth/confirm page.
 *
 * While visible it marks `document.body.dataset.welcomeOpen` so a section
 * onboarding won't pop over it; on dismiss («Супер!») it dispatches a
 * `welcome-dismissed` event so the current page's onboarding can start.
 */
export default function WelcomeModal() {
  const [info, setInfo] = useState<WelcomeInfo | null>(null);

  function dismiss() {
    setInfo(null);
    try { delete document.body.dataset.welcomeOpen; } catch {}
    try { window.dispatchEvent(new Event('welcome-dismissed')); } catch {}
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem('welcomeModal');
      if (raw) {
        setInfo(JSON.parse(raw));
        localStorage.removeItem('welcomeModal');
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!info) return;
    try { document.body.dataset.welcomeOpen = '1'; } catch {}
    return () => { try { delete document.body.dataset.welcomeOpen; } catch {} };
  }, [info]);

  if (!info) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 16,
        padding: '36px 32px', maxWidth: 420, width: '100%',
        textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>
          Добро пожаловать в INDEXALL!
        </h2>

        {/* Tariff info */}
        <div style={{
          background: '#fffbe6', border: '1px solid #f5c800',
          borderRadius: 10, padding: '14px 18px', marginBottom: 20,
          textAlign: 'left',
        }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>Вам подключён тариф</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>«{info.name}»</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 13 }}>
              Срок действия: <strong>{info.days} дней</strong>
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#22c55e' }}>0 ₽</span>
          </div>
        </div>

        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24, lineHeight: 1.6 }}>
          Посмотреть все тарифы вы можете в разделе{' '}
          <strong>Тарифов</strong> в меню пользователя.
        </p>

        <button
          onClick={dismiss}
          style={{
            width: '100%', padding: '14px',
            background: '#f5c800', color: '#1a1a1a',
            border: 'none', borderRadius: 10,
            fontWeight: 800, fontSize: 16, cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          Супер!
        </button>
      </div>
    </div>
  );
}
