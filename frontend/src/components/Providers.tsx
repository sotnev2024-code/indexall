'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAppStore } from '@/store/app.store';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function AuthHydrator() {
  const { setAuth, setAuthReady, clearAuth } = useAppStore();

  useEffect(() => {
    // Refresh on every page load when a token exists — NOT only when user is null.
    // The cached `user` in localStorage is a paint-time optimization, not the
    // source of truth: plan changes made by admin / trial activation land in the
    // DB but need a round-trip to show up. Without this, users see their old
    // plan until they logout+login. One extra GET /auth/me per full page load
    // is cheap.
    const token = localStorage.getItem('token');
    if (!token) { setAuthReady(true); return; }
    axios.get(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      withCredentials: true,
    })
      .then(({ data }) => setAuth(data, token))
      .catch((err) => {
        // Only clear auth on 401 (invalid/expired token) — transient network
        // errors shouldn't log the user out. `authReady` still flips so the UI
        // unblocks instead of hanging on a spinner.
        if (err?.response?.status === 401) clearAuth();
        else setAuthReady(true);
      });
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
