'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setResendMessage('');
    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/auth/login`, { email, password });

      if (response.data.error) {
        if (response.data.unverified) {
          setUnverified(true);
          setUnverifiedEmail(response.data.email || email);
          setError('');
        } else {
          setError(response.data.error);
        }
        setLoading(false);
        return;
      }

      localStorage.setItem('token', response.data.accessToken);
      router.push('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResendMessage('');
    try {
      await axios.post(`${API_URL}/auth/confirm/resend`, { email: unverifiedEmail });
      setResendMessage('Письмо отправлено — проверьте почту');
    } catch {
      setResendMessage('Не удалось отправить письмо, попробуйте позже');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 bg-yellow rounded-full flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-wider">INDEXALL</h1>
        </div>

        <div className="flex mb-6 border border-border rounded-lg overflow-hidden">
          <button className="flex-1 py-2 bg-black text-white font-semibold">
            Вход
          </button>
          <button
            onClick={() => router.push('/auth/register')}
            className="flex-1 py-2 bg-white hover:bg-gray-100"
          >
            Регистрация
          </button>
        </div>

        <form onSubmit={handleLogin}>
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {unverified && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm font-semibold text-yellow-800 mb-1">Email не подтверждён</p>
              <p className="text-xs text-yellow-700 mb-3">
                Проверьте почту <strong>{unverifiedEmail}</strong> и перейдите по ссылке в письме.
                Если письмо не пришло — проверьте папку «Спам».
              </p>
              {resendMessage && (
                <p className="text-xs text-green-700 mb-2">{resendMessage}</p>
              )}
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="text-xs font-semibold text-yellow-800 underline underline-offset-2 disabled:opacity-50"
              >
                {resending ? 'Отправляем…' : 'Отправить письмо повторно'}
              </button>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs text-muted mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-field"
              placeholder="name@example.com"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-xs text-muted mb-2">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary disabled:opacity-50"
          >
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
