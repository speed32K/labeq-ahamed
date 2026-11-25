/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppLockOverlay } from './components/AppLockOverlay';
import { BalanceStrip } from './components/BalanceStrip';
import { CanvasBoard } from './components/CanvasBoard';
import { ConfirmDialog, type ConfirmDialogState } from './components/ConfirmDialog';
import { EntryComposer } from './components/EntryComposer';
import { LandingHomePage } from './components/LandingHomePage';
import { LedgerTable } from './components/LedgerTable';
import { NotificationCenter } from './components/NotificationCenter';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OpeningBalanceModal } from './components/OpeningBalanceModal';
import { ProfileSettingsModal } from './components/ProfileSettingsModal';
import { RemoteSyncBanner } from './components/RemoteSyncBanner';
import { TopBar, type WorkspaceView } from './components/TopBar';
import { useAuth } from './contexts/AuthContext';
import { useAppLock } from './hooks/useAppLock';
import { broadcastLocalEntrySync, subscribeToCrossTabEntrySync } from './lib/crossTabSync';
import { createInitialSeedState, GROUPS } from './data/groups';
import {
  clearAllLedgerDataInFirestore,
  createLedgerEntryInFirestore,
  deleteLedgerEntryInFirestore,
  deleteOpeningOverrideInFirestore,
  ensureUserProfile,
  importLedgerStateToFirestore,
  reorderDayEntriesInFirestore,
  saveOpeningOverrideInFirestore,
  subscribeToUserLedger,
  updateLedgerEntryInFirestore,
} from './lib/firestoreLedger';
import {
  broadcastChangeNotification,
  countUnreadNotifications,
  getOrCreateDeviceId,
  saveNotificationReadState,
  subscribeToBroadcastNotifications,
  subscribeToNotificationReadState,
  type ActivityNotificationItem,
  type NotificationAction,
} from './lib/firestoreNotifications';
import {
  cancelSubKoRequestInFirestore,
  createSubKoVerificationRequestInFirestore,
  reviewSubKoRequestInFirestore,
  saveProjectAnimationInFirestore,
  subscribeToProjectConfig,
  subscribeToSubKoRequests,
} from './lib/firestoreOwnership';
import {
  createDefaultProjectConfig,
  PRIMARY_OWNER_KO_EMAIL,
  validateSubKoCandidate,
  type AnimationPreset,
  type ProjectOwnershipConfig,
  type SubKoRequestRecord,
} from './lib/ownership';
import {
  applyRemoteEntryToAppState,
  type RemoteEntrySyncEvent,
  type RemoteEntrySyncKind,
} from './lib/remoteSyncTrigger';
import type {
  AppState,
  BalanceSnapshot,
  BusinessGroupName,
  ComputedLedgerRow,
  LogEntry,
} from './types/ledger';
import {
  applyEntryToLedgerAtomically,
  computeDayLedger,
  formatDisplayDate,
  formatNum,
  getSortedDates,
  round2,
  shiftISO,
  todayISO,
} from './utils/accounting';
import { exportLedgerXlsx, parseWorkbookToImport } from './utils/excel';

const STORAGE_KEY = 'shop_daily_logs_v1';
const LAST_READ_STORAGE_KEY = 'shop_daily_logs_notifications_read_ms';
const BROWSER_ALERTS_STORAGE_KEY = 'shop_daily_logs_browser_alerts';
const PROJECT_CONFIG_STORAGE_KEY = 'shop_daily_logs_project_config_v1';
const SUBKO_REQUESTS_STORAGE_KEY = 'shop_daily_logs_subko_requests_v1';

function loadInitialProjectConfig(): ProjectOwnershipConfig {
  try {
    const raw = localStorage.getItem(PROJECT_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProjectOwnershipConfig>;
      const base = createDefaultProjectConfig();
      return {
        ...base,
        animationPreset: parsed.animationPreset || base.animationPreset,
        animationTitle:
          typeof parsed.animationTitle === 'string' ? parsed.animationTitle : base.animationTitle,
        updatedByUid: parsed.updatedByUid || base.updatedByUid,
        updatedAtMs:
          typeof parsed.updatedAtMs === 'number' && Number.isFinite(parsed.updatedAtMs)
            ? parsed.updatedAtMs
            : base.updatedAtMs,
      };
    }
  } catch {
    // Ignore local storage read failures
  }
  return createDefaultProjectConfig();
}

function loadInitialSubKoRequests(): SubKoRequestRecord[] {
  try {
    const raw = localStorage.getItem(SUBKO_REQUESTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as SubKoRequestRecord[];
      }
    }
  } catch {
    // Ignore local storage read failures
  }
  return [];
}

function loadInitialLastReadMs(): number {
  try {
    const raw = localStorage.getItem(LAST_READ_STORAGE_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function loadInitialBrowserAlertsEnabled(): boolean {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  try {
    return localStorage.getItem(BROWSER_ALERTS_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function loadInitialState(): AppState {
  const today = todayISO();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      return {
        entriesByDate: parsed.entriesByDate || {},
        openingOverrides: parsed.openingOverrides || {},
        customServices: parsed.customServices || {},
        initialized: true,
      };
    }
  } catch (err) {
    console.warn('Could not read saved daily logs from localStorage:', err);
  }
  return createInitialSeedState(today);
}

export default function App() {
  const {
    user,
    authReady,
    signingIn,
    verifyingAccess,
    authError,
    signInWithGoogle,
    signInWithEmail,
    signOutUser,
    clearAuthError,
  } = useAuth();
  const appLock = useAppLock();
  const bypassHomeGate = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  }, []);
  const [appState, setAppState] = useState<AppState>(() => loadInitialState());
  const [selectedDate, setSelectedDate] = useState<string>(() => todayISO());
  const [viewMode, setViewMode] = useState<WorkspaceView>('canvas');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [filterGroup, setFilterGroup] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [openingModalOpen, setOpeningModalOpen] = useState<boolean>(false);
  const [profileModalOpen, setProfileModalOpen] = useState<boolean>(false);
  const [projectConfig, setProjectConfig] = useState<ProjectOwnershipConfig>(() =>
    loadInitialProjectConfig()
  );
  const [subKoRequests, setSubKoRequests] = useState<SubKoRequestRecord[]>(() =>
    loadInitialSubKoRequests()
  );
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [chartCollapsed, setChartCollapsed] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<ActivityNotificationItem[]>([]);
  const [remoteSyncEvents, setRemoteSyncEvents] = useState<RemoteEntrySyncEvent[]>([]);
  const [remoteSyncedEntryIds, setRemoteSyncedEntryIds] = useState<
    Record<string, RemoteEntrySyncKind>
  >({});
  const [lastReadAtMs, setLastReadAtMs] = useState<number>(() => loadInitialLastReadMs());
  const [browserAlertsEnabled, setBrowserAlertsEnabled] = useState<boolean>(() =>
    loadInitialBrowserAlertsEnabled()
  );

  const currentDeviceId = useMemo(() => getOrCreateDeviceId(), []);
  const browserAlertsSupported =
    typeof window !== 'undefined' && typeof Notification !== 'undefined';
  const browserAlertsEnabledRef = useRef<boolean>(browserAlertsEnabled);
  browserAlertsEnabledRef.current = browserAlertsEnabled;
  const lastDirectEntrySyncAtRef = useRef<number>(0);
  const remoteHighlightTimerRef = useRef<number | null>(null);

  const appStateRef = useRef<AppState>(appState);
  appStateRef.current = appState;
  const bootstrappedUidRef = useRef<string | null>(null);

  const commitAppState = useCallback((updater: AppState | ((prev: AppState) => AppState)) => {
    const next = typeof updater === 'function' ? updater(appStateRef.current) : updater;
    appStateRef.current = next;
    setAppState(next);
  }, []);

  const toastTimerRef = useRef<number | null>(null);
  const serviceInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }, []);

  const notifyCloudError = useCallback(
    (err: unknown, fallback: string) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Quota exceeded')) {
        showToast('Daily cloud database quota exceeded. It resets tomorrow.');
        return;
      }
      showToast(fallback);
    },
    [showToast]
  );

  const handleRemoteEntrySyncEvents = useCallback((events: RemoteEntrySyncEvent[]) => {
    if (events.length === 0) return;
    lastDirectEntrySyncAtRef.current = Date.now();

    setRemoteSyncEvents((prev) => {
      const merged = [...events, ...prev];
      const seen = new Set<string>();
      const unique: RemoteEntrySyncEvent[] = [];
      for (const ev of merged) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        unique.push(ev);
        if (unique.length >= 10) break;
      }
      return unique;
    });

    setRemoteSyncedEntryIds((prev) => {
      const next = { ...prev };
      for (const ev of events) {
        next[ev.entryId] = ev.kind;
      }
      return next;
    });

    if (remoteHighlightTimerRef.current !== null) {
      window.clearTimeout(remoteHighlightTimerRef.current);
    }
    remoteHighlightTimerRef.current = window.setTimeout(() => {
      setRemoteSyncedEntryIds({});
    }, 15000);

    const primary = events[0];
    if (
      browserAlertsEnabledRef.current &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification(`Shop Daily Log · ${primary.headline}`, {
          body: primary.detail,
          tag: primary.id,
        });
      } catch {
        // Ignore Notification constructor restrictions in embedded iframes
      }
    }
  }, []);

  const handleDismissRemoteSync = useCallback(() => {
    setRemoteSyncEvents([]);
    setRemoteSyncedEntryIds({});
    if (remoteHighlightTimerRef.current !== null) {
      window.clearTimeout(remoteHighlightTimerRef.current);
      remoteHighlightTimerRef.current = null;
    }
  }, []);

  const handleViewRemoteSyncedEntry = useCallback((event: RemoteEntrySyncEvent) => {
    setSelectedDate(event.entry.date);
    setFilterGroup('ALL');
    setSearchQuery('');
    window.setTimeout(() => {
      const el = document.querySelector(`[data-entry-id="${CSS.escape(event.entryId)}"]`);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  }, []);

  // Surface authentication errors via toast only when already inside the workspace;
  // on the initial home page, LandingHomePage renders authError inline in an alert banner.
  useEffect(() => {
    if (authError && (user || bypassHomeGate)) {
      showToast(authError);
      clearAuthError();
    }
  }, [authError, user, bypassHomeGate, clearAuthError, showToast]);

  // Persist local cache only when signed out (signed-in users use Firestore as single source of truth)
  useEffect(() => {
    if (user) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (err) {
      console.warn('Could not persist daily logs to localStorage:', err);
    }
  }, [appState, user]);

  useEffect(() => {
    if (user) return;
    try {
      localStorage.setItem(PROJECT_CONFIG_STORAGE_KEY, JSON.stringify(projectConfig));
      localStorage.setItem(SUBKO_REQUESTS_STORAGE_KEY, JSON.stringify(subKoRequests));
    } catch {
      // Ignore storage quota errors
    }
  }, [projectConfig, subKoRequests, user]);

  // Real-time cross-tab synchronization for local/unauthenticated sessions
  useEffect(() => {
    if (user) return;
    return subscribeToCrossTabEntrySync(currentDeviceId, (syncEvent) => {
      commitAppState((prev) => applyRemoteEntryToAppState(prev, syncEvent.entry, syncEvent.kind));
      handleRemoteEntrySyncEvents([syncEvent]);
    });
  }, [user, currentDeviceId, commitAppState, handleRemoteEntrySyncEvents]);

  // Real-time Firestore synchronization & cross-device broadcast notifications when authenticated
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      bootstrappedUidRef.current = null;
      setNotifications([]);
      setProjectConfig(loadInitialProjectConfig());
      setSubKoRequests(loadInitialSubKoRequests());
      return;
    }

    let cancelled = false;
    let unsubscribeLedger: (() => void) | null = null;
    let unsubscribeNotifications: (() => void) | null = null;
    let unsubscribeReadState: (() => void) | null = null;
    let unsubscribeProjectConfig: (() => void) | null = null;
    let unsubscribeSubKoRequests: (() => void) | null = null;

    const connectCloudWorkspace = async () => {
      try {
        await ensureUserProfile(user);
        if (cancelled) return;

        unsubscribeLedger = subscribeToUserLedger(user.uid, {
          currentDeviceId,
          onSnapshotUpdate: (entriesByDate, openingOverrides, meta) => {
            if (cancelled || !meta.entriesLoaded || !meta.overridesLoaded) return;

            const cloudHasEntries = Object.keys(entriesByDate).length > 0;
            const cloudHasOverrides = Object.keys(openingOverrides).length > 0;

            if (
              !cloudHasEntries &&
              !cloudHasOverrides &&
              bootstrappedUidRef.current !== user.uid
            ) {
              bootstrappedUidRef.current = user.uid;
              const localSnapshot = appStateRef.current;
              const localHasData =
                Object.keys(localSnapshot.entriesByDate).length > 0 ||
                Object.keys(localSnapshot.openingOverrides).length > 0;

              if (localHasData) {
                void importLedgerStateToFirestore(
                  user.uid,
                  localSnapshot.entriesByDate,
                  localSnapshot.openingOverrides,
                  { entriesByDate: {}, openingOverrides: {}, initialized: true },
                  'replace',
                  currentDeviceId
                ).catch((err) =>
                  notifyCloudError(err, 'Could not sync initial entries to cloud.')
                );
                return;
              }
            }

            bootstrappedUidRef.current = user.uid;
            commitAppState({
              initialized: true,
              entriesByDate,
              openingOverrides,
            });
          },
          onRemoteEntryChanges: (events) => {
            if (cancelled) return;
            handleRemoteEntrySyncEvents(events);
          },
          onError: (err) => {
            notifyCloudError(err, 'Unable to sync ledger with cloud database.');
          },
        });

        unsubscribeReadState = subscribeToNotificationReadState(user.uid, {
          onReadCursor: (cursorMs) => {
            if (cancelled) return;
            setLastReadAtMs((prev) => {
              const next = Math.max(prev, cursorMs);
              try {
                localStorage.setItem(LAST_READ_STORAGE_KEY, String(next));
              } catch {
                // Ignore storage quota errors
              }
              return next;
            });
          },
          onError: () => {
            // Read cursor is non-blocking; local read state still functions
          },
        });

        unsubscribeNotifications = subscribeToBroadcastNotifications({
          currentDeviceId,
          onFeedUpdate: (items) => {
            if (cancelled) return;
            setNotifications(items);
          },
          onRemoteIncoming: (item) => {
            if (cancelled) return;
            const isSameAccountEntryMutation =
              item.actorId === user.uid &&
              (item.action === 'entry_added' || item.action === 'entry_updated');
            const recentlyHandledByLedgerTrigger =
              Date.now() - lastDirectEntrySyncAtRef.current < 4000;
            if (isSameAccountEntryMutation && recentlyHandledByLedgerTrigger) {
              return;
            }
            showToast(`${item.actorName}: ${item.summary}`);
            if (
              browserAlertsEnabledRef.current &&
              typeof Notification !== 'undefined' &&
              Notification.permission === 'granted'
            ) {
              try {
                new Notification('Shop Daily Log · Update', {
                  body: `${item.actorName}: ${item.summary}`,
                  tag: item.id,
                });
              } catch {
                // Ignore Notification constructor restrictions in embedded iframes
              }
            }
          },
          onError: (err) => {
            notifyCloudError(err, 'Unable to subscribe to live change notifications.');
          },
        });

        unsubscribeProjectConfig = subscribeToProjectConfig({
          onConfig: (config) => {
            if (cancelled) return;
            setProjectConfig(config);
          },
          onError: (err) => {
            notifyCloudError(err, 'Unable to sync project setup configuration.');
          },
        });

        unsubscribeSubKoRequests = subscribeToSubKoRequests(user, {
          onRequests: (requests) => {
            if (cancelled) return;
            setSubKoRequests(requests);
          },
          onError: (err) => {
            notifyCloudError(err, 'Unable to sync Sub-KO verification requests.');
          },
        });
      } catch (err) {
        if (!cancelled) {
          notifyCloudError(err, 'Unable to initialize your cloud workspace.');
        }
      }
    };

    void connectCloudWorkspace();

    return () => {
      cancelled = true;
      if (unsubscribeLedger) unsubscribeLedger();
      if (unsubscribeNotifications) unsubscribeNotifications();
      if (unsubscribeReadState) unsubscribeReadState();
      if (unsubscribeProjectConfig) unsubscribeProjectConfig();
      if (unsubscribeSubKoRequests) unsubscribeSubKoRequests();
    };
  }, [
    authReady,
    user,
    currentDeviceId,
    commitAppState,
    handleRemoteEntrySyncEvents,
    notifyCloudError,
    showToast,
  ]);

  const emitChangeNotification = useCallback(
    (action: NotificationAction, summary: string, targetDate: string) => {
      if (!user) return;
      void broadcastChangeNotification(user, currentDeviceId, {
        action,
        summary,
        targetDate,
      }).catch((err) => {
        notifyCloudError(err, 'Change saved, but notification broadcast failed.');
      });
    },
    [user, currentDeviceId, notifyCloudError]
  );

  const unreadNotificationCount = useMemo(
    () => (user ? countUnreadNotifications(notifications, lastReadAtMs, currentDeviceId) : 0),
    [user, notifications, lastReadAtMs, currentDeviceId]
  );

  const pendingSubKoCount = useMemo(
    () => subKoRequests.filter((req) => req.status === 'pending').length,
    [subKoRequests]
  );

  const handleSaveProjectAnimation = useCallback(
    (preset: AnimationPreset, title: string) => {
      const cleanTitle = title.trim() || 'Shop Daily Log Workspace';
      setProjectConfig((prev) => ({
        ...prev,
        primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
        animationPreset: preset,
        animationTitle: cleanTitle,
        updatedByUid: user?.uid || 'local',
        updatedAtMs: Date.now(),
      }));

      if (user) {
        void saveProjectAnimationInFirestore(user, preset, cleanTitle).catch((err) =>
          notifyCloudError(err, 'Could not save project animation to cloud.')
        );
        emitChangeNotification(
          'project_updated',
          `Updated project animation (${preset.replace('_', ' ')})`,
          selectedDate
        );
      }
      showToast('Project animation saved.');
    },
    [user, selectedDate, emitChangeNotification, notifyCloudError, showToast]
  );

  const handleSubmitSubKoVerification = useCallback(
    (gmailAddress: string): { ok: boolean; error?: string } => {
      const validation = validateSubKoCandidate(gmailAddress, subKoRequests);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }

      const normalizedEmail = validation.normalizedEmail;
      if (user) {
        void createSubKoVerificationRequestInFirestore(user, normalizedEmail).catch((err) =>
          notifyCloudError(err, 'Could not send Sub-KO verification request.')
        );
        emitChangeNotification(
          'subko_requested',
          `Sub-KO verification requested for ${normalizedEmail} (pending approval from ${PRIMARY_OWNER_KO_EMAIL})`,
          selectedDate
        );
      } else {
        const now = Date.now();
        const localReq: SubKoRequestRecord = {
          id: `local_subko_${now}`,
          subKoEmail: normalizedEmail,
          requestedByUid: 'local',
          requestedByName: 'Local Profile',
          primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
          status: 'pending',
          reviewedByUid: null,
          createdAtMs: now,
          updatedAtMs: now,
        };
        setSubKoRequests((prev) => [localReq, ...prev]);
      }

      showToast(
        `Verification request sent to ${PRIMARY_OWNER_KO_EMAIL} for ${normalizedEmail}.`
      );
      return { ok: true };
    },
    [user, subKoRequests, selectedDate, emitChangeNotification, notifyCloudError, showToast]
  );

  const handleReviewSubKoRequest = useCallback(
    (requestId: string, decision: 'approved' | 'declined') => {
      if (!user) {
        showToast(`Sign in as ${PRIMARY_OWNER_KO_EMAIL} to approve or decline Sub-KO requests.`);
        return;
      }
      const target = subKoRequests.find((r) => r.id === requestId);
      void reviewSubKoRequestInFirestore(user, requestId, decision).catch((err) =>
        notifyCloudError(err, 'Could not update Sub-KO verification status.')
      );
      if (target) {
        emitChangeNotification(
          decision === 'approved' ? 'subko_approved' : 'subko_declined',
          decision === 'approved'
            ? `Approved Sub-KO role for ${target.subKoEmail}`
            : `Declined Sub-KO request for ${target.subKoEmail}`,
          selectedDate
        );
      }
      showToast(
        decision === 'approved'
          ? 'Sub-KO role approved and finalized.'
          : 'Sub-KO request declined.'
      );
    },
    [user, subKoRequests, selectedDate, emitChangeNotification, notifyCloudError, showToast]
  );

  const handleCancelSubKoRequest = useCallback(
    (requestId: string) => {
      if (user) {
        void cancelSubKoRequestInFirestore(requestId).catch((err) =>
          notifyCloudError(err, 'Could not cancel Sub-KO verification request.')
        );
      } else {
        setSubKoRequests((prev) => prev.filter((r) => r.id !== requestId));
      }
      showToast('Sub-KO verification request cancelled.');
    },
    [user, notifyCloudError, showToast]
  );

  const handleMarkAllNotificationsRead = useCallback(() => {
    const newestMs = notifications[0]?.createdAtMs ?? 0;
    const nextMs = Math.max(Date.now(), newestMs);
    setLastReadAtMs(nextMs);
    try {
      localStorage.setItem(LAST_READ_STORAGE_KEY, String(nextMs));
    } catch {
      // Ignore storage errors
    }
    if (user) {
      void saveNotificationReadState(user.uid, nextMs).catch((err) =>
        notifyCloudError(err, 'Could not sync notification read state.')
      );
    }
  }, [notifications, user, notifyCloudError]);

  const handleToggleBrowserAlerts = useCallback(async () => {
    if (!browserAlertsSupported) {
      showToast('Browser push alerts are not supported on this device.');
      return;
    }

    if (browserAlertsEnabled) {
      setBrowserAlertsEnabled(false);
      try {
        localStorage.setItem(BROWSER_ALERTS_STORAGE_KEY, 'false');
      } catch {
        // Ignore storage errors
      }
      showToast('Browser push alerts paused. In-app live notifications stay on.');
      return;
    }

    if (Notification.permission === 'granted') {
      setBrowserAlertsEnabled(true);
      try {
        localStorage.setItem(BROWSER_ALERTS_STORAGE_KEY, 'true');
      } catch {
        // Ignore storage errors
      }
      showToast('Browser push alerts enabled for this device.');
      return;
    }

    if (Notification.permission === 'denied') {
      showToast('Browser notifications are blocked in browser settings. In-app alerts remain active.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setBrowserAlertsEnabled(true);
        try {
          localStorage.setItem(BROWSER_ALERTS_STORAGE_KEY, 'true');
        } catch {
          // Ignore storage errors
        }
        showToast('Browser push alerts enabled for this device.');
      } else {
        setBrowserAlertsEnabled(false);
        showToast('Permission not granted. In-app live notifications remain active.');
      }
    } catch {
      showToast('Could not request browser alert permission. In-app alerts remain active.');
    }
  }, [browserAlertsEnabled, browserAlertsSupported, showToast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (remoteHighlightTimerRef.current !== null) {
        window.clearTimeout(remoteHighlightTimerRef.current);
      }
    };
  }, []);

  const dayLedger = useMemo(
    () => computeDayLedger(appState, selectedDate),
    [appState, selectedDate]
  );

  const { dayDebit, dayCredit } = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const row of dayLedger.rows) {
      debit += row.debit || 0;
      credit += row.credit || 0;
    }
    return {
      dayDebit: round2(debit),
      dayCredit: round2(credit),
    };
  }, [dayLedger.rows]);

  const dailyPerformanceChartData = useMemo(
    () => [
      {
        date: formatDisplayDate(selectedDate),
        dayDebit,
        dayCredit,
      },
    ],
    [selectedDate, dayDebit, dayCredit]
  );

  const dayNetFlow = round2(dayCredit - dayDebit);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return dayLedger.rows.filter((r) => {
      if (filterGroup !== 'ALL' && r.type !== filterGroup) return false;
      if (q) {
        const hay = `${r.type} ${r.serviceType} ${r.remarks} ${r.paymentMode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [dayLedger.rows, filterGroup, searchQuery]);

  const savedDates = useMemo(() => {
    return getSortedDates(appState)
      .reverse()
      .map((date) => ({
        date,
        count: appState.entriesByDate[date]?.length ?? 0,
      }));
  }, [appState]);

  const editingEntry = useMemo(() => {
    if (!editingEntryId) return null;
    const list = appState.entriesByDate[selectedDate] || [];
    return list.find((item) => item.id === editingEntryId) || null;
  }, [appState.entriesByDate, selectedDate, editingEntryId]);

  const availableBalancesForComposer = useMemo<BalanceSnapshot>(() => {
    const base: BalanceSnapshot = {
      ko: dayLedger.closing.ko,
      cash: dayLedger.closing.cash,
      fino: dayLedger.closing.fino,
      airtel: dayLedger.closing.airtel,
      bank: dayLedger.closing.bank,
      credit: dayLedger.closing.credit,
    };
    if (!editingEntryId) return base;
    const row = dayLedger.rows.find((r) => r.id === editingEntryId);
    if (!row) return base;
    // Restore the currently edited entry's previous impact when validating its updated amount
    return {
      ko: base.ko - row.deltas.ko,
      cash: base.cash - row.deltas.cash,
      fino: base.fino - row.deltas.fino,
      airtel: base.airtel - row.deltas.airtel,
      bank: base.bank - row.deltas.bank,
      credit: base.credit - row.deltas.credit,
    };
  }, [dayLedger, editingEntryId]);

  const customServicesByGroup = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const entries of Object.values(appState.entriesByDate)) {
      for (const entry of entries) {
        const known = GROUPS[entry.type as BusinessGroupName]?.services || [];
        if (entry.serviceType && !known.includes(entry.serviceType)) {
          if (!map[entry.type]) map[entry.type] = new Set();
          map[entry.type].add(entry.serviceType);
        }
      }
    }
    const out: Record<string, string[]> = {};
    for (const [k, set] of Object.entries(map)) {
      out[k] = Array.from(set);
    }
    return out;
  }, [appState.entriesByDate]);

  const handleSelectDate = (iso: string) => {
    setSelectedDate(iso);
    setEditingEntryId(null);
  };

  const handleSubmitEntry = (
    payload: Omit<LogEntry, 'id'> & { id?: string }
  ): { ok: boolean; error?: string } => {
    const result = applyEntryToLedgerAtomically(appStateRef.current, payload);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    commitAppState(result.state);

    const amountParts: string[] = [];
    if (result.entry.debit > 0) amountParts.push(`Dr ${formatNum(result.entry.debit)}`);
    if (result.entry.credit > 0) amountParts.push(`Cr ${formatNum(result.entry.credit)}`);
    const amountSuffix = amountParts.length > 0 ? ` (${amountParts.join(' / ')})` : '';

    if (user) {
      const dayList = result.state.entriesByDate[result.entry.date] || [];
      const orderIndex = Math.max(
        0,
        dayList.findIndex((item) => item.id === result.entry.id)
      );
      const writePromise = payload.id
        ? updateLedgerEntryInFirestore(user.uid, result.entry, orderIndex, currentDeviceId)
        : createLedgerEntryInFirestore(user.uid, result.entry, orderIndex, currentDeviceId);
      void writePromise.catch((err) =>
        notifyCloudError(err, 'Could not save entry to cloud database.')
      );
      emitChangeNotification(
        payload.id ? 'entry_updated' : 'entry_added',
        `${payload.id ? 'Updated' : 'Added'} ${result.entry.type} · ${result.entry.serviceType}${amountSuffix}`,
        result.entry.date
      );
    } else {
      broadcastLocalEntrySync(
        currentDeviceId,
        payload.id ? 'updated' : 'added',
        result.entry
      );
    }

    const reductionNote = result.walletReduction?.applied
      ? ` · ${result.walletReduction.accountLabel} -${formatNum(result.walletReduction.amount)} (Bal: ${formatNum(result.walletReduction.resultingBalance)})`
      : '';

    if (payload.id) {
      setEditingEntryId(null);
      showToast(`Entry updated${reductionNote}.`);
    } else {
      showToast(`Entry added to canvas${reductionNote}.`);
    }
    return { ok: true };
  };

  const handleStartEdit = (id: string) => {
    setEditingEntryId(id);
    if (viewMode === 'table') {
      setViewMode('canvas');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRequestDelete = (row: ComputedLedgerRow) => {
    setConfirmDialog({
      title: 'Delete log entry?',
      message: `Remove entry #${row.seq} (${row.type} · ${row.serviceType})? Running balances for this date and subsequent days will recalculate automatically.`,
      confirmLabel: 'Delete Entry',
      destructive: true,
      onConfirm: () => {
        commitAppState((prev) => {
          const list = (prev.entriesByDate[selectedDate] || []).filter((x) => x.id !== row.id);
          const nextEntriesByDate = { ...prev.entriesByDate };
          if (list.length === 0) {
            delete nextEntriesByDate[selectedDate];
          } else {
            nextEntriesByDate[selectedDate] = list;
          }
          return {
            ...prev,
            entriesByDate: nextEntriesByDate,
          };
        });
        if (user) {
          void deleteLedgerEntryInFirestore(user.uid, row.id).catch((err) =>
            notifyCloudError(err, 'Could not delete entry from cloud database.')
          );
          emitChangeNotification(
            'entry_deleted',
            `Deleted ${row.type} · ${row.serviceType}`,
            selectedDate
          );
        }
        if (editingEntryId === row.id) setEditingEntryId(null);
        showToast('Entry deleted.');
      },
    });
  };

  const handleReorderEntries = (fromId: string, toId: string) => {
    const prev = appStateRef.current;
    const list = [...(prev.entriesByDate[selectedDate] || [])];
    const fromIdx = list.findIndex((x) => x.id === fromId);
    const toIdx = list.findIndex((x) => x.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    const reorderedIds = list.map((item) => item.id);

    commitAppState({
      ...prev,
      entriesByDate: {
        ...prev.entriesByDate,
        [selectedDate]: list,
      },
    });
    if (user) {
      void reorderDayEntriesInFirestore(user.uid, reorderedIds, currentDeviceId).catch((err) =>
        notifyCloudError(err, 'Could not save entry order to cloud database.')
      );
      emitChangeNotification(
        'entries_reordered',
        `Reordered ${reorderedIds.length} entries for ${formatDisplayDate(selectedDate)}`,
        selectedDate
      );
    }
    showToast('Entry order updated; balances recalculated.');
  };

  const handleMoveEntryByOffset = (id: string, offset: -1 | 1) => {
    const prev = appStateRef.current;
    const list = [...(prev.entriesByDate[selectedDate] || [])];
    const idx = list.findIndex((x) => x.id === id);
    const targetIdx = idx + offset;
    if (idx === -1 || targetIdx < 0 || targetIdx >= list.length) return;
    const [moved] = list.splice(idx, 1);
    list.splice(targetIdx, 0, moved);
    const reorderedIds = list.map((item) => item.id);

    commitAppState({
      ...prev,
      entriesByDate: {
        ...prev.entriesByDate,
        [selectedDate]: list,
      },
    });
    if (user) {
      void reorderDayEntriesInFirestore(user.uid, reorderedIds, currentDeviceId).catch((err) =>
        notifyCloudError(err, 'Could not save entry order to cloud database.')
      );
      emitChangeNotification(
        'entries_reordered',
        `Reordered ${reorderedIds.length} entries for ${formatDisplayDate(selectedDate)}`,
        selectedDate
      );
    }
    showToast('Entry order updated; balances recalculated.');
  };

  const handleSaveOpeningBalances = (balances: BalanceSnapshot) => {
    const alreadyExists = Boolean(appStateRef.current.openingOverrides[selectedDate]);
    commitAppState((prev) => ({
      ...prev,
      openingOverrides: {
        ...prev.openingOverrides,
        [selectedDate]: balances,
      },
    }));
    if (user) {
      void saveOpeningOverrideInFirestore(user.uid, selectedDate, balances, alreadyExists).catch(
        (err) => notifyCloudError(err, 'Could not save opening balances to cloud database.')
      );
      emitChangeNotification(
        'opening_saved',
        `Updated opening balances for ${formatDisplayDate(selectedDate)}`,
        selectedDate
      );
    }
    setOpeningModalOpen(false);
    showToast('Opening balances saved.');
  };

  const handleResetOpeningAuto = () => {
    const hadOverride = Boolean(appStateRef.current.openingOverrides[selectedDate]);
    commitAppState((prev) => {
      const nextOverrides = { ...prev.openingOverrides };
      delete nextOverrides[selectedDate];
      return {
        ...prev,
        openingOverrides: nextOverrides,
      };
    });
    if (user && hadOverride) {
      void deleteOpeningOverrideInFirestore(user.uid, selectedDate).catch((err) =>
        notifyCloudError(err, 'Could not reset opening override in cloud database.')
      );
      emitChangeNotification(
        'opening_reset',
        `Reset opening balances to carry-forward for ${formatDisplayDate(selectedDate)}`,
        selectedDate
      );
    }
    setOpeningModalOpen(false);
    showToast('Reverted to automatic carry-forward.');
  };

  const handleRequestResetAll = () => {
    setConfirmDialog({
      title: 'Reset all stored logs?',
      message: user
        ? 'This clears every saved daily log entry and opening balance override from your cloud account. Export to .xlsx first if you want a backup.'
        : 'This clears every saved daily log entry and opening balance override from browser storage. Export to .xlsx first if you want a backup.',
      confirmLabel: 'Clear All Data',
      destructive: true,
      onConfirm: () => {
        const snapshotBeforeClear = appStateRef.current;
        commitAppState({
          entriesByDate: {},
          openingOverrides: {},
          initialized: true,
        });
        if (user) {
          void clearAllLedgerDataInFirestore(user.uid, snapshotBeforeClear).catch((err) =>
            notifyCloudError(err, 'Could not clear all cloud records.')
          );
          emitChangeNotification('ledger_cleared', 'Cleared all stored ledger entries', selectedDate);
        }
        setEditingEntryId(null);
        showToast('All stored logs cleared.');
      },
    });
  };

  const handleExport = (allDates: boolean) => {
    const result = exportLedgerXlsx(appState, selectedDate, allDates);
    if (!result.exported) {
      showToast('No entries available to export.');
      return;
    }
    showToast(`Exported ${result.rowCount} rows to ${result.filename}`);
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        if (!(buffer instanceof ArrayBuffer)) {
          showToast('Could not read the selected file.');
          return;
        }
        const parsed = parseWorkbookToImport(buffer, selectedDate);
        if (parsed.importedCount === 0) {
          showToast('No valid log rows were found in that spreadsheet.');
          return;
        }

        const applyImport = (mode: 'replace' | 'merge') => {
          const prevSnapshot = appStateRef.current;
          commitAppState((prev) => {
            if (mode === 'replace') {
              return {
                initialized: true,
                entriesByDate: parsed.entriesByDate,
                openingOverrides: parsed.openingOverrides,
              };
            }
            const mergedEntries: Record<string, LogEntry[]> = { ...prev.entriesByDate };
            for (const [d, rows] of Object.entries(parsed.entriesByDate)) {
              mergedEntries[d] = [...(mergedEntries[d] || []), ...rows];
            }
            return {
              ...prev,
              initialized: true,
              entriesByDate: mergedEntries,
              openingOverrides: {
                ...prev.openingOverrides,
                ...parsed.openingOverrides,
              },
            };
          });
          if (user) {
            void importLedgerStateToFirestore(
              user.uid,
              parsed.entriesByDate,
              parsed.openingOverrides,
              prevSnapshot,
              mode,
              currentDeviceId
            ).catch((err) => notifyCloudError(err, 'Could not sync imported entries to cloud.'));
            emitChangeNotification(
              'ledger_imported',
              `Imported ${parsed.importedCount} entries (${mode}) from ${file.name}`,
              parsed.lastDate
            );
          }
          setSelectedDate(parsed.lastDate);
          setEditingEntryId(null);
          showToast(`Imported ${parsed.importedCount} entries from ${file.name}.`);
        };

        if (savedDates.length > 0) {
          setConfirmDialog({
            title: `Import ${parsed.importedCount} entries from ${file.name}?`,
            message:
              'You already have logs saved in this browser. Choose whether to replace existing logs or merge the imported spreadsheet rows into your workspace.',
            confirmLabel: 'Replace Existing',
            secondaryLabel: 'Merge Into Existing',
            onConfirm: () => applyImport('replace'),
            onSecondary: () => applyImport('merge'),
          });
        } else {
          applyImport('replace');
        }
      } catch (err) {
        console.error('Excel import failed:', err);
        showToast('Failed to parse .xlsx file. Verify it is a valid Excel workbook.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFocusComposer = () => {
    if (viewMode === 'table') {
      setViewMode('canvas');
      window.setTimeout(() => {
        serviceInputRef.current?.focus();
        serviceInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
      return;
    }
    serviceInputRef.current?.focus();
    serviceInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (!user && !bypassHomeGate) {
    return (
      <>
        <LandingHomePage
          signingIn={signingIn}
          verifyingAccess={verifyingAccess || !authReady}
          authError={authError}
          onSignIn={() => void signInWithGoogle()}
          onEmailLogin={(email) => void signInWithEmail(email)}
          onClearError={clearAuthError}
        />
        <OfflineIndicator />
        <AppLockOverlay
          isLocked={appLock.isLocked}
          settings={appLock.settings}
          biometricSupported={appLock.biometricSupported}
          onUnlockBiometric={appLock.unlockWithBiometric}
          onUnlockPasscode={appLock.unlockWithPasscode}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        viewMode={viewMode}
        onChangeView={setViewMode}
        onImportFile={handleImportFile}
        onExportDay={() => handleExport(false)}
        onExportAll={() => handleExport(true)}
        hasAnyEntries={savedDates.length > 0}
        hasDayEntries={dayLedger.rows.length > 0}
        user={user}
        authReady={authReady}
        signingIn={signingIn}
        onSignIn={() => void signInWithGoogle()}
        onSignOut={() => void signOutUser()}
        onOpenProfile={() => setProfileModalOpen(true)}
        pendingSubKoCount={pendingSubKoCount}
        notificationSlot={
          <NotificationCenter
            user={user}
            signingIn={signingIn}
            notifications={notifications}
            unreadCount={unreadNotificationCount}
            lastReadAtMs={lastReadAtMs}
            currentDeviceId={currentDeviceId}
            browserAlertsEnabled={browserAlertsEnabled}
            browserAlertsSupported={browserAlertsSupported}
            onToggleBrowserAlerts={() => void handleToggleBrowserAlerts()}
            onMarkAllRead={handleMarkAllNotificationsRead}
            onSelectNotificationDate={handleSelectDate}
            onSignIn={() => void signInWithGoogle()}
          />
        }
      />

      <BalanceStrip
        selectedDate={selectedDate}
        onChangeDate={handleSelectDate}
        onPrevDay={() => handleSelectDate(shiftISO(selectedDate, -1))}
        onNextDay={() => handleSelectDate(shiftISO(selectedDate, 1))}
        onToday={() => handleSelectDate(todayISO())}
        opening={dayLedger.opening}
        closing={dayLedger.closing}
        isManualOpening={dayLedger.isManual}
        openingSourceDate={dayLedger.sourceDate}
        onOpenBalanceModal={() => setOpeningModalOpen(true)}
      />

      <RemoteSyncBanner
        events={remoteSyncEvents}
        editingEntryId={editingEntryId}
        onViewEntry={handleViewRemoteSyncedEntry}
        onDismiss={handleDismissRemoteSync}
      />

      <main className="flex-1 flex flex-col lg:flex-row min-h-0">
        {viewMode === 'canvas' ? (
          <>
            <EntryComposer
              selectedDate={selectedDate}
              editingEntry={editingEntry}
              availableBalances={availableBalancesForComposer}
              savedDates={savedDates}
              customServicesByGroup={customServicesByGroup}
              serviceInputRef={serviceInputRef}
              onSubmitEntry={handleSubmitEntry}
              onCancelEdit={() => setEditingEntryId(null)}
              onSelectDate={handleSelectDate}
              onRequestResetAll={handleRequestResetAll}
            />
            <CanvasBoard
              allDayRows={dayLedger.rows}
              visibleRows={visibleRows}
              filterGroup={filterGroup}
              searchQuery={searchQuery}
              editingEntryId={editingEntryId}
              remoteSyncedEntryIds={remoteSyncedEntryIds}
              onChangeFilterGroup={setFilterGroup}
              onChangeSearchQuery={setSearchQuery}
              onEditEntry={handleStartEdit}
              onDeleteEntry={handleRequestDelete}
              onReorderEntries={handleReorderEntries}
              onMoveEntryByOffset={handleMoveEntryByOffset}
              onFocusComposer={handleFocusComposer}
              chartSlot={
                <section
                  aria-label="Daily net performance chart"
                  data-testid="daily-performance-chart"
                  className="bg-white border border-slate-200 rounded-lg px-4 py-3 mb-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                      <h2 className="text-xs font-semibold text-slate-900">
                        Daily Debit vs Credit · {formatDisplayDate(selectedDate)}
                      </h2>
                      <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono tabular-nums">
                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                          <span
                            className="w-2.5 h-2.5 rounded-[2px] bg-[#dc2626]"
                            aria-hidden="true"
                          />
                          <span className="font-sans">Debit:</span>
                          <strong className="text-red-700">{formatNum(dayDebit)}</strong>
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                          <span
                            className="w-2.5 h-2.5 rounded-[2px] bg-[#1f5e4b]"
                            aria-hidden="true"
                          />
                          <span className="font-sans">Credit:</span>
                          <strong className="text-emerald-700">{formatNum(dayCredit)}</strong>
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                          <span className="font-sans">Net:</span>
                          <strong
                            className={dayNetFlow < 0 ? 'text-red-700' : 'text-slate-900'}
                          >
                            {dayNetFlow > 0 ? '+' : ''}
                            {formatNum(dayNetFlow)}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setChartCollapsed((prev) => !prev)}
                      aria-expanded={!chartCollapsed}
                      aria-label={
                        chartCollapsed
                          ? 'Expand performance chart'
                          : 'Collapse performance chart'
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                    >
                      <span>{chartCollapsed ? 'Show' : 'Hide'}</span>
                      {chartCollapsed ? (
                        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {!chartCollapsed && (
                    <div className="mt-3 h-[176px] w-full min-w-0">
                      <ResponsiveContainer width="100%" height="100%" minWidth={240}>
                        <BarChart
                          data={dailyPerformanceChartData}
                          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                          barGap={24}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#e2e8f0"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 11, fill: '#475569' }}
                            axisLine={{ stroke: '#cbd5e1' }}
                            tickLine={false}
                          />
                          <YAxis
                            domain={
                              dayDebit === 0 && dayCredit === 0 ? [0, 1000] : [0, 'auto']
                            }
                            tickFormatter={(val: number) => {
                              const abs = Math.abs(val);
                              if (abs >= 100000) {
                                return `${(val / 100000).toFixed(1).replace(/\.0$/, '')}L`;
                              }
                              if (abs >= 1000) {
                                return `${(val / 1000).toFixed(1).replace(/\.0$/, '')}k`;
                              }
                              return String(val);
                            }}
                            tick={{ fontSize: 11, fill: '#64748b' }}
                            axisLine={false}
                            tickLine={false}
                            width={48}
                          />
                          <Tooltip
                            cursor={{ fill: '#f1f5f9', opacity: 0.7 }}
                            formatter={(value, name) => [
                              `${formatNum(Number(value) || 0)} INR`,
                              String(name),
                            ]}
                            contentStyle={{
                              backgroundColor: '#ffffff',
                              borderColor: '#e2e8f0',
                              borderRadius: '8px',
                              fontSize: '12px',
                              boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
                            }}
                          />
                          <Legend
                            wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }}
                            iconType="square"
                            iconSize={10}
                          />
                          <Bar
                            dataKey="dayDebit"
                            name="Debit (Dr)"
                            fill="#dc2626"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={88}
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="dayCredit"
                            name="Credit (Cr)"
                            fill="#1f5e4b"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={88}
                            isAnimationActive={false}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </section>
              }
            />
          </>
        ) : (
          <LedgerTable
            rows={visibleRows}
            closing={dayLedger.closing}
            remoteSyncedEntryIds={remoteSyncedEntryIds}
            onEditEntry={handleStartEdit}
            onDeleteEntry={handleRequestDelete}
            onFocusComposer={handleFocusComposer}
          />
        )}
      </main>

      <OpeningBalanceModal
        isOpen={openingModalOpen}
        selectedDate={selectedDate}
        initialBalances={dayLedger.opening}
        isManual={dayLedger.isManual}
        onClose={() => setOpeningModalOpen(false)}
        onSave={handleSaveOpeningBalances}
        onResetAuto={handleResetOpeningAuto}
      />

      <ProfileSettingsModal
        isOpen={profileModalOpen}
        user={user}
        signingIn={signingIn}
        projectConfig={projectConfig}
        subKoRequests={subKoRequests}
        onClose={() => setProfileModalOpen(false)}
        onSignIn={() => void signInWithGoogle()}
        onSaveProjectAnimation={handleSaveProjectAnimation}
        onSubmitSubKoVerification={handleSubmitSubKoVerification}
        onReviewSubKoRequest={handleReviewSubKoRequest}
        onCancelSubKoRequest={handleCancelSubKoRequest}
        appLock={appLock}
        onStatusToast={showToast}
      />

      <ConfirmDialog
        dialog={confirmDialog}
        onClose={() => setConfirmDialog(null)}
      />

      <OfflineIndicator />

      <AppLockOverlay
        isLocked={appLock.isLocked}
        settings={appLock.settings}
        biometricSupported={appLock.biometricSupported}
        onUnlockBiometric={appLock.unlockWithBiometric}
        onUnlockPasscode={appLock.unlockWithPasscode}
      />

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
