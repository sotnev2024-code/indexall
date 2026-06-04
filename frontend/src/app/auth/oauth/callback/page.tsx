'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { useAppStore } from '@/store/app.store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function OAuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAppStore();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');
    const isNew = searchParams.get('isNew') === '1';
    const demoSheetId = searchParams.get('demoSheetId');
    const trialActivated = searchParams.get('trialActivated') === '1';
    const trialName = searchParams.get('trialName') || '';
    const trialDays = parseInt(searchParams.get('trialDays') || '0', 10);

    if (error) {
      setErrorMsg(decodeURIComponent(error));
      setStatus('error');
      return;
    }

    if (!token) {
      setErrorMsg('Токен не получен от провайдера');
      setStatus('error');
      return;
    }

    (async () => {
      try {
        localStorage.setItem('token', token);

        const { data: me } = await axios.get(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setAuth(me, token);

        if (trialActivated) {
          localStorage.setItem('welcomeModal', JSON.stringify({ name: trialName, days: trialDays }));
        }

        router.replace(demoSheetId ? `/spec/${demoSheetId}` : '/projects');
      } catch {
        setErrorMsg('Не удалось получить данные профиля');
        setStatus('error');
      }
    })();
  }, []);

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 40, maxWidth: 420, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Ошибка входа</h2>
          <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>{errorMsg}</p>
          <button
            onClick={() => router.replace('/auth/login')}
            style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 600, cursor: 'pointer' }}
          >
            Вернуться к входу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e5e7eb', borderTopColor: '#111', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#666', fontSize: 14 }}>Выполняется вход…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
}
