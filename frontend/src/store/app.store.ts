import { create } from 'zustand';

interface User { id: number; email: string; plan: string; name: string; }

interface AppStore {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  activeProjectId: number | null;
  activeSheetId: number | null;
  setActive: (projectId: number, sheetId: number) => void;
  hasUnsaved: boolean;
  setUnsaved: (v: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  user: null,
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    set({ user, token });
  },
  clearAuth: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null });
  },
  activeProjectId: typeof window !== 'undefined' ? (Number(localStorage.getItem('activeProjectId')) || null) : null,
  activeSheetId:   typeof window !== 'undefined' ? (Number(localStorage.getItem('activeSheetId'))   || null) : null,
  setActive: (projectId, sheetId) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('activeProjectId', String(projectId));
      localStorage.setItem('activeSheetId',   String(sheetId));
    }
    set({ activeProjectId: projectId, activeSheetId: sheetId });
  },
  hasUnsaved: false,
  setUnsaved: (v) => set({ hasUnsaved: v }),
}));
