'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/app.store';
import toast from 'react-hot-toast';

interface HeaderProps {
  breadcrumb?: string;
  projectCost?: string;
  showSave?: boolean;
  onSave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoCount?: number;
}

export default function Header({ breadcrumb = 'Проекты', projectCost, showSave, onSave, onUndo, onRedo, canUndo, canRedo, undoCount }: HeaderProps) {
  const router = useRouter();
  const { user, clearAuth, hasUnsaved } = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);

  function logout() {
    clearAuth();
    router.push('/auth/login');
  }

  function handleLogoClick() {
    if (hasUnsaved) {
      if (confirm('Есть несохранённые изменения. Сохранить перед уходом?')) {
        onSave?.();
      }
    }
    router.push('/projects');
  }

  const isAdmin = user?.plan === 'admin';

  return (
    <header className="app-header">
      {/* Logo */}
      <div className="logo-btn" onClick={handleLogoClick}>
        <img src="/logo.png" alt="INDEXALL" style={{ height: 38, objectFit: 'contain' }} />
      </div>

      {/* Undo/Redo */}
      <div className="header-nav">
        <button className="nav-btn" onClick={onUndo} disabled={!canUndo} title="Отменить">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7h10a6 6 0 0 1 0 12H3"/><polyline points="7 3 3 7 7 11"/>
          </svg>
        </button>
        {!!undoCount && <span className="undo-counter">{undoCount}</span>}
        <button className="nav-btn" onClick={onRedo} disabled={!canRedo} title="Повторить">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 7H11a6 6 0 0 0 0 12h10"/><polyline points="17 3 21 7 17 11"/>
          </svg>
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="breadcrumb">
        <span className="breadcrumb-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f5c800" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </span>
        <span className="breadcrumb-text">{breadcrumb}</span>
      </div>

      {/* Right side */}
      <div className="header-right">
        {showSave && (
          <>
            {hasUnsaved && <span className="unsaved-dot" title="Несохранённые изменения" />}
            <button className="btn-save" onClick={onSave}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Сохранить
            </button>
          </>
        )}
        {projectCost && <span className="project-cost">{projectCost}</span>}

        {/* User menu */}
        <div className="user-menu-wrap">
          <button className="user-btn" onClick={() => setMenuOpen(v => !v)}>
            <span>{user?.email?.split('@')[0] || 'User'}</span>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          </button>
          {menuOpen && (
            <div className="user-menu" onClick={() => setMenuOpen(false)}>
              {isAdmin && (
                <div className="user-menu-item admin" onClick={() => router.push('/admin')}>
                  ⚙ Панель администратора
                </div>
              )}
              <div className="user-menu-item" onClick={() => router.push('/pricing')}>
                <span>★ Тарифы</span>
                {user?.plan === 'free' && (
                  <span style={{ fontSize: 10, color: '#f5c800', marginLeft: 6, fontWeight: 700 }}>UPGRADE</span>
                )}
              </div>
              <div className="user-menu-item" onClick={() => router.push('/profile')}>Профиль</div>
              <div className="user-menu-item" onClick={logout}>Выход</div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
