'use client';
import dynamic from 'next/dynamic';

const SpecPageClient = dynamic(() => import('./SpecPageClient'), {
  ssr: false,
  loading: () => <div style={{ padding: 20 }}>Загрузка...</div>,
});

export default function SpecPage() {
  return <SpecPageClient />;
}
