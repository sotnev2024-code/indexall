'use client';

interface Props {
  size?: 'sm' | 'md';
}

export default function ProBadge({ size = 'sm' }: Props) {
  const padding = size === 'sm' ? '1px 6px' : '2px 8px';
  const fontSize = size === 'sm' ? 9 : 11;
  return (
    <span
      title="Доступно в тарифе PRO"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        background: '#f5c800', color: '#1a1a1a',
        padding, borderRadius: 4, fontSize, fontWeight: 700, letterSpacing: 0.3,
        verticalAlign: 'middle',
      }}
    >
      🔒 PRO
    </span>
  );
}
