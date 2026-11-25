import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Download, LogIn, LogOut, Upload, UserCircle } from 'lucide-react';
import type { User } from 'firebase/auth';
import { PWAInstallButton } from './PWAInstallButton';

export type WorkspaceView = 'canvas' | 'table';

interface TopBarProps {
  viewMode: WorkspaceView;
  onChangeView: (mode: WorkspaceView) => void;
  onImportFile: (file: File) => void;
  onExportDay: () => void;
  onExportAll: () => void;
  hasAnyEntries: boolean;
  hasDayEntries: boolean;
  user: User | null;
  authReady: boolean;
  signingIn: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenProfile: () => void;
  pendingSubKoCount?: number;
  notificationSlot?: ReactNode;
}

export function TopBar({
  viewMode,
  onChangeView,
  onImportFile,
  onExportDay,
  onExportAll,
  hasAnyEntries,
  hasDayEntries,
  user,
  authReady,
  signingIn,
  onSignIn,
  onSignOut,
  onOpenProfile,
  pendingSubKoCount = 0,
  notificationSlot,
}: TopBarProps) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [exportMenuOpen]);

  return (
    <>
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-3 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-8">
        {/* Zone 1: Single-line brand wordmark */}
        <span className="font-semibold text-[13px] min-[380px]:text-sm sm:text-[17px] tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          Shop Daily Log
        </span>

        {/* Zone 2: Clean single-line navigation links (desktop/tablet) */}
        <nav
          aria-label="Workspace navigation"
          className="hidden sm:flex items-center gap-6 h-full"
        >
          <button
            type="button"
            onClick={() => onChangeView('canvas')}
            aria-current={viewMode === 'canvas' ? 'page' : undefined}
            className={`h-full inline-flex items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1f5e4b] ${
              viewMode === 'canvas'
                ? 'border-[#1f5e4b] text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Canvas
          </button>

          <button
            type="button"
            onClick={() => onChangeView('table')}
            aria-current={viewMode === 'table' ? 'page' : undefined}
            className={`h-full inline-flex items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1f5e4b] ${
              viewMode === 'table'
                ? 'border-[#1f5e4b] text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Excel Ledger
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-full inline-flex items-center gap-1.5 text-sm font-medium border-b-2 border-transparent text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1f5e4b]"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Import .xlsx</span>
          </button>
        </nav>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          aria-label="Import Excel file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = '';
          }}
        />

        {/* Zone 3: Install App + Notifications + Profile Icon + Account Action + Primary CTA */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <PWAInstallButton variant="light" />
          {notificationSlot}

          <button
            type="button"
            data-testid="profile-icon-button"
            onClick={onOpenProfile}
            aria-label={
              pendingSubKoCount > 0
                ? `Profile (${pendingSubKoCount} pending Sub-KO requests)`
                : 'Profile'
            }
            title="Profile & Project Settings"
            className="relative inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-colors shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
          >
            <UserCircle className="w-4 h-4" aria-hidden="true" />
            {pendingSubKoCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white"
              />
            )}
          </button>

          {authReady &&
            (user ? (
              <div className="flex items-center gap-1.5">
                <span
                  title={user.email || user.displayName || 'Signed in account'}
                  className="hidden lg:inline-block max-w-[130px] truncate text-xs font-medium text-slate-600"
                >
                  {user.displayName || user.email?.split('@')[0] || 'Account'}
                </span>
                <button
                  type="button"
                  onClick={onSignOut}
                  aria-label="Sign out"
                  className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={signingIn}
                onClick={onSignIn}
                aria-label="Sign in"
                className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-2 rounded-lg text-[11px] sm:text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {signingIn ? 'Signing in...' : 'Sign in'}
                </span>
              </button>
            ))}

          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              onClick={() => setExportMenuOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-lg text-[11px] sm:text-sm font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sm:hidden">Export</span>
              <span className="hidden sm:inline">Export .xlsx</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />
            </button>

            {exportMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-40"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasDayEntries}
                  onClick={() => {
                    setExportMenuOpen(false);
                    onExportDay();
                  }}
                  className="w-full text-left px-3.5 py-2.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  Export selected day (.xlsx)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasAnyEntries}
                  onClick={() => {
                    setExportMenuOpen(false);
                    onExportAll();
                  }}
                  className="w-full text-left px-3.5 py-2.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  Export all logged days (.xlsx)
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Non-sticky mobile workspace nav bar so sticky height stays <= 56px and zero items clip */}
      <nav
        aria-label="Mobile workspace navigation"
        className="sm:hidden bg-white border-b border-slate-200 px-4 h-11 flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-5 h-full">
          <button
            type="button"
            onClick={() => onChangeView('canvas')}
            aria-current={viewMode === 'canvas' ? 'page' : undefined}
            className={`h-full inline-flex items-center text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'canvas'
                ? 'border-[#1f5e4b] text-slate-900'
                : 'border-transparent text-slate-600'
            }`}
          >
            Canvas
          </button>
          <button
            type="button"
            onClick={() => onChangeView('table')}
            aria-current={viewMode === 'table' ? 'page' : undefined}
            className={`h-full inline-flex items-center text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'table'
                ? 'border-[#1f5e4b] text-slate-900'
                : 'border-transparent text-slate-600'
            }`}
          >
            Excel Ledger
          </button>
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Import .xlsx</span>
        </button>
      </nav>
    </>
  );
}
