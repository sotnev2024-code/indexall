'use client';
import { useRouter } from 'next/navigation';

interface Props {
  open: boolean;
  onClose: () => void;
  feature?: string;
}

/**
 * Modal shown when a free user tries to use a PRO-only feature.
 * Renders nothing when `open` is false.
 */
export default function ProUpgradeModal({ open, onClose, feature }: Props) {
  const router = useRouter();
  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, padding: 32, maxWidth: 440, width: '90%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 28 }}>🔒</span>
          <span style={{
            background: '#f5c800', color: '#1a1a1a', padding: '3px 10px',
            borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          }}>PRO</span>
        </div>

        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#1a1a1a' }}>
          Доступно в платном тарифе
        </h3>

        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5, marginBottom: 22 }}>
          {feature
            ? `«${feature}» доступно только в платном тарифе PRO.`
            : 'Эта возможность доступна только в платном тарифе PRO.'}
          <br />
          Оформите подписку или активируйте бесплатный пробный период на 7 дней.
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => { onClose(); router.push('/pricing'); }}
            style={{
              flex: 1, padding: '11px 16px', background: '#1a1a1a', color: '#f5c800',
              border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}
          >
            Перейти к тарифам
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '11px 16px', background: '#fff', color: '#6b7280',
              border: '1px solid #e5e7eb', borderRadius: 8, fontWeight: 500, fontSize: 14, cursor: 'pointer',
            }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
