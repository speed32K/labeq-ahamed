import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCheck, LogIn } from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  formatRelativeTime,
  getNotificationActionLabel,
  isNotificationUnread,
  type ActivityNotificationItem,
} from '../lib/firestoreNotifications';
import { formatDisplayDate } from '../utils/accounting';

interface NotificationCenterProps {
  user: User | null;
  signingIn: boolean;
  notifications: ActivityNotificationItem[];
  unreadCount: number;
  lastReadAtMs: number;
  currentDeviceId: string;
  browserAlertsEnabled: boolean;
  browserAlertsSupported: boolean;
  onToggleBrowserAlerts: () => void;
  onMarkAllRead: () => void;
  onSelectNotificationDate: (dateISO: string) => void;
  onSignIn: () => void;
}

export function NotificationCenter({
  user,
  signingIn,
  notifications,
  unreadCount,
  lastReadAtMs,
  currentDeviceId,
  browserAlertsEnabled,
  browserAlertsSupported,
  onToggleBrowserAlerts,
  onMarkAllRead,
  onSelectNotificationDate,
  onSignIn,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        data-testid="notification-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'
        }
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
      >
        {browserAlertsEnabled && user ? (
          <BellRing className="w-4 h-4 text-[#1f5e4b]" aria-hidden="true" />
        ) : (
          <Bell className="w-4 h-4" aria-hidden="true" />
        )}
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold font-mono tabular-nums inline-flex items-center justify-center leading-none ring-2 ring-white"
          >
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Live activity notifications"
          data-testid="notification-panel"
          className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-[60px] sm:top-full sm:mt-1.5 sm:w-[360px] max-h-[70vh] flex flex-col bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden"
        >
          {/* Panel Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
              <p className="text-[11px] text-slate-500 truncate">
                {user
                  ? 'Live updates across all logged-in devices & accounts'
                  : 'Sign in to broadcast & receive live changes'}
              </p>
            </div>
            {user && unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#1f5e4b] hover:bg-emerald-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Mark read</span>
              </button>
            )}
          </div>

          {/* Signed-in Browser Alerts Bar */}
          {user && browserAlertsSupported && (
            <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2 text-xs bg-white">
              <span className="text-slate-600">Browser push alerts</span>
              <button
                type="button"
                role="switch"
                aria-checked={browserAlertsEnabled}
                onClick={onToggleBrowserAlerts}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  browserAlertsEnabled ? 'bg-[#1f5e4b]' : 'bg-slate-200'
                }`}
              >
                <span className="sr-only">Toggle browser push alerts</span>
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    browserAlertsEnabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          )}

          {/* Panel Body */}
          {!user ? (
            <div className="px-5 py-7 text-center">
              <Bell className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
              <p className="mt-2.5 text-sm font-medium text-slate-900">
                Real-time change alerts
              </p>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                Sign in with Google to receive instant notifications whenever a change is made from
                any logged-in device or account.
              </p>
              <button
                type="button"
                disabled={signingIn}
                onClick={() => {
                  setOpen(false);
                  onSignIn();
                }}
                className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] disabled:opacity-50 transition-colors cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{signingIn ? 'Signing in...' : 'Sign in with Google'}</span>
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-xs font-medium text-slate-700">No activity notifications yet</p>
              <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                Any entry, edit, deletion, import, or balance update from any logged-in device or
                account will appear here immediately.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-y-auto flex-1">
              {notifications.map((item) => {
                const unread = isNotificationUnread(item, lastReadAtMs, currentDeviceId);
                const isThisDevice = item.deviceId === currentDeviceId;
                const isOtherAccount = item.actorId !== user.uid;
                const sourceLabel = isThisDevice
                  ? 'This device'
                  : isOtherAccount
                    ? 'Another account'
                    : 'Another device';

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (item.targetDate) {
                          onSelectNotificationDate(item.targetDate);
                        }
                        if (unread) {
                          onMarkAllRead();
                        }
                        setOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer flex items-start gap-2.5 ${
                        unread ? 'bg-emerald-50/40' : 'bg-white'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                          unread ? 'bg-[#1f5e4b]' : 'bg-slate-200'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-semibold text-slate-900 truncate">
                            {getNotificationActionLabel(item.action)}
                          </span>
                          <span className="text-slate-400 shrink-0 font-mono tabular-nums">
                            {formatRelativeTime(item.createdAtMs)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-700 leading-snug break-words">
                          {item.summary}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
                          <span className="font-medium text-slate-600 truncate max-w-[140px]">
                            {item.actorName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{sourceLabel}</span>
                          {item.targetDate && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatDisplayDate(item.targetDate)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
