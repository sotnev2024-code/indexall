'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data } = await axios.post(`${API_URL}/auth/register`, { name, email, password });
      if (data.accessToken) {
        localStorage.setItem('token', data.accessToken);
        router.push('/projects');
      } else {
        setSent(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResendMessage('');
    try {
      await axios.post(`${API_URL}/auth/confirm/resend`, { email });
      setResendMessage('Письмо отправлено повторно');
    } catch {
      setResendMessage('Не удалось отправить письмо, попробуйте позже');
    } finally {
      setResending(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 bg-yellow rounded-full flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-wider">INDEXALL</h1>
          </div>

          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.95 13a19.79 19.79 0 01-3.07-8.67A2 2 0 012.86 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
            </svg>
          </div>

          <h2 className="text-xl font-bold mb-2">Проверьте почту</h2>
          <p className="text-sm text-gray-500 mb-1">
            Письмо с подтверждением отправлено на:
          </p>
          <p className="font-semibold text-sm mb-6 break-all">{email}</p>

          <p className="text-xs text-gray-400 mb-6">
            Если письмо не пришло в течение минуты — проверьте папку «Спам».
          </p>

          {resendMessage && (
            <p className="text-xs text-green-600 mb-4">{resendMessage}</p>
          )}

          <button
            onClick={handleResend}
            disabled={resending}
            className="w-full py-2 border border-border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 mb-3"
          >
            {resending ? 'Отправляем…' : 'Отправить письмо повторно'}
          </button>

          <button
            onClick={() => router.push('/auth/login')}
            className="w-full btn-primary"
          >
            Войти
          </button>
        </div>
      </div>
    );
  }

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
          <button
            onClick={() => router.push('/auth/login')}
            className="flex-1 py-2 bg-white hover:bg-gray-100"
          >
            Вход
          </button>
          <button className="flex-1 py-2 bg-black text-white font-semibold">
            Регистрация
          </button>
        </div>

        <form onSubmit={handleRegister}>
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs text-muted mb-2">Имя</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="input-field"
              placeholder="Иван Иванов"
              required
            />
          </div>

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
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary disabled:opacity-50"
          >
            {loading ? 'Регистрация…' : 'Зарегистрироваться'}
          </button>
        </form>
      </div>
    </div>
  );
}
