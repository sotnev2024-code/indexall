'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setErrorMessage('Токен подтверждения отсутствует в ссылке');
      return;
    }

    axios
      .get(`${API_URL}/auth/confirm`, { params: { token } })
      .then(res => {
        if (res.data.accessToken) {
          localStorage.setItem('token', res.data.accessToken);
          setStatus('success');
          setTimeout(() => router.replace('/projects'), 1500);
        } else {
          setStatus('error');
          setErrorMessage('Неожиданный ответ сервера');
        }
      })
      .catch(err => {
        setStatus('error');
        setErrorMessage(
          err.response?.data?.message || 'Ссылка недействительна или устарела'
        );
      });
  }, [searchParams, router]);

  return (
    <>
      {status === 'loading' && (
        <>
          <div className="w-12 h-12 border-4 border-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">Подтверждаем email…</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2">Email подтверждён!</h2>
          <p className="text-sm text-gray-500">Перенаправляем вас в раздел проектов…</p>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2">Ошибка подтверждения</h2>
          <p className="text-sm text-gray-500 mb-6">{errorMessage}</p>
          <button
            onClick={() => router.push('/auth/register')}
            className="w-full btn-primary mb-3"
          >
            Зарегистрироваться заново
          </button>
          <button
            onClick={() => router.push('/auth/login')}
            className="w-full py-2 border border-border rounded-lg text-sm hover:bg-gray-50"
          >
            Войти
          </button>
        </>
      )}
    </>
  );
}

export default function ConfirmPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md text-center">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 bg-yellow rounded-full flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-wider">INDEXALL</h1>
        </div>

        <Suspense fallback={
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-500">Загрузка…</p>
          </div>
        }>
          <ConfirmContent />
        </Suspense>
      </div>
    </div>
  );
}
