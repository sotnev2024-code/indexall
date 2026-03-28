'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      router.replace('/projects');
    } else {
      router.replace('/auth/login');
    }
  }, [router]);
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Загрузка...</div>;
}
