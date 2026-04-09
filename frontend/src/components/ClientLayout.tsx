'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import axios from 'axios';
import { useAppStore } from '@/store/app.store';
import NavigationProgress from '@/components/NavigationProgress';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function AuthHydrator() {
  const { user, setAuth, clearAuth } = useAppStore();
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && !user) {
      axios.get(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        withCredentials: true,
      })
        .then(({ data }: any) => setAuth(data, token))
        .catch(() => clearAuth());
    }
  }, []);
  return null;
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <AuthHydrator />
      <NavigationProgress />
      {children}
      <Toaster position="bottom-right" toastOptions={{ duration: 2500 }} />
    </QueryClientProvider>
  );
}
