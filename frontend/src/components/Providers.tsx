'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/app.store';

function AuthHydrator() {
  const { user, setAuth, clearAuth } = useAppStore();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && !user) {
      import('@/lib/api').then(({ default: api }) => {
        api.get('/auth/me')
          .then(({ data }) => setAuth(data, token))
          .catch(() => clearAuth());
      });
    }
  }, []);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <AuthHydrator />
      {children}
    </QueryClientProvider>
  );
}
