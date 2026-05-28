'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const PROVIDERS = [
  {
    id: 'google',
    label: 'Google',
    bg: '#fff',
    color: '#333',
    border: '1px solid #dadce0',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
        <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
        <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
        <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
      </svg>
    ),
  },
  {
    id: 'yandex',
    label: 'Яндекс',
    bg: '#FC3F1D',
    color: '#fff',
    border: 'none',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
        <path d="M14.341 21H17V3h-2.953C9.837 3 7.5 5.373 7.5 8.748c0 2.815 1.431 4.574 3.988 6.384L7.5 21h2.803l4.254-6.437-.826-.576C11.814 12.677 10.5 11.374 10.5 8.748c0-2.07 1.435-3.748 3.547-3.748H14.341V21z"/>
      </svg>
    ),
  },
];

interface Props {
  mode?: 'login' | 'register';
}

export default function SocialLoginButtons({ mode = 'login' }: Props) {
  const handleClick = (providerId: string) => {
    const baseApi = API_URL.replace('/api', '');
    window.location.href = `${baseApi}/api/auth/oauth/${providerId}`;
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        <span style={{ color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>
          или войдите через
        </span>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleClick(p.id)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              width: '100%', padding: '9px 16px', borderRadius: 8, cursor: 'pointer',
              background: p.bg, color: p.color, border: p.border,
              fontSize: 14, fontWeight: 500,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {p.icon}
            {mode === 'register' ? `Зарегистрироваться через ${p.label}` : `Войти через ${p.label}`}
          </button>
        ))}
      </div>
    </div>
  );
}
