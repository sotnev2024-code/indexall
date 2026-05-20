'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import axios from 'axios';
import { useAppStore } from '@/store/app.store';
import NavigationProgress from '@/components/NavigationProgress';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function AuthHydrator() {
  const { setAuth, setAuthReady, clearAuth } = useAppStore();
  useEffect(() => {
    // Always refresh on page load — cached `user` in localStorage goes stale
    // whenever admin/trial changes the plan, leading to paywall redirects that
    // only clear after logout+login.
    const token = localStorage.getItem('token');
    if (!token) { setAuthReady(true); return; }
    axios.get(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      withCredentials: true,
    })
      .then(({ data }: any) => setAuth(data, token))
      .catch((err: any) => {
        if (err?.response?.status === 401) {
          clearAuth();
          // Redirect to login only if the current page requires auth (not public pages)
          const pub = ['/', '/auth/', '/pricing'];
          const isPublic = pub.some(p => window.location.pathname.startsWith(p));
          if (!isPublic) {
            window.location.href = '/auth/login';
          }
        } else {
          // Network error / server down — don't log out, keep using cached user
          setAuthReady(true);
        }
      });
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
