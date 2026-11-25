import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreErrors';

export type NotificationAction =
  | 'entry_added'
  | 'entry_updated'
  | 'entry_deleted'
  | 'entries_reordered'
  | 'opening_saved'
  | 'opening_reset'
  | 'ledger_imported'
  | 'ledger_cleared'
  | 'project_updated'
  | 'subko_requested'
  | 'subko_approved'
  | 'subko_declined';

export interface ActivityNotificationItem {
  id: string;
  actorId: string;
  actorName: string;
  deviceId: string;
  audience: 'all_logged_in';
  action: NotificationAction;
  summary: string;
  targetDate: string;
  createdAtMs: number;
}

// Blueprint-synchronized constants (matches firebase-blueprint.json & firestore.rules)
export const NOTIFICATION_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
  MAX_ID_LEN: 128,
  MAX_DEVICE_ID_LEN: 64,
  MAX_ACTOR_NAME_LEN: 80,
  MAX_SUMMARY_LEN: 200,
  MAX_FEED_ITEMS: 50,
  AUDIENCE: 'all_logged_in' as const,
} as const;

const ALLOWED_ACTIONS = new Set<NotificationAction>([
  'entry_added',
  'entry_updated',
  'entry_deleted',
  'entries_reordered',
  'opening_saved',
  'opening_reset',
  'ledger_imported',
  'ledger_cleared',
  'project_updated',
  'subko_requested',
  'subko_approved',
  'subko_declined',
]);

const DEVICE_STORAGE_KEY = 'shop_daily_log_device_session_id';

export function getOrCreateDeviceId(): string {
  try {
    const existing = sessionStorage.getItem(DEVICE_STORAGE_KEY);
    if (
      existing &&
      existing.length >= 1 &&
      existing.length <= NOTIFICATION_LIMITS.MAX_DEVICE_ID_LEN &&
      NOTIFICATION_LIMITS.ID_PATTERN.test(existing)
    ) {
      return existing;
    }
    const created = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(DEVICE_STORAGE_KEY, created);
    return created;
  } catch {
    return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Extracts a non-PII display label for broadcast notifications (never emits full email address).
 */
export function sanitizeActorName(displayName?: string | null, email?: string | null): string {
  const cleanDisplay = (displayName || '').trim();
  if (cleanDisplay.length > 0 && !cleanDisplay.includes('@')) {
    return cleanDisplay.slice(0, NOTIFICATION_LIMITS.MAX_ACTOR_NAME_LEN);
  }
  const cleanEmail = (email || '').trim();
  if (cleanEmail.includes('@')) {
    const handle = cleanEmail.split('@')[0].trim();
    if (handle.length > 0) {
      return handle.slice(0, NOTIFICATION_LIMITS.MAX_ACTOR_NAME_LEN);
    }
  }
  return 'Team Member';
}

export function sanitizeNotificationPayload(params: {
  id: string;
  actorId: string;
  actorName: string;
  deviceId: string;
  action: NotificationAction;
  summary: string;
  targetDate: string;
}) {
  const safeId =
    params.id.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, NOTIFICATION_LIMITS.MAX_ID_LEN) ||
    `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeDeviceId =
    params.deviceId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, NOTIFICATION_LIMITS.MAX_DEVICE_ID_LEN) ||
    'dev_unknown';
  const safeActorName =
    params.actorName.trim().slice(0, NOTIFICATION_LIMITS.MAX_ACTOR_NAME_LEN) || 'Team Member';
  const safeAction: NotificationAction = ALLOWED_ACTIONS.has(params.action)
    ? params.action
    : 'entry_updated';
  const safeSummary =
    params.summary.trim().slice(0, NOTIFICATION_LIMITS.MAX_SUMMARY_LEN) || 'Updated daily log';
  const safeDate = NOTIFICATION_LIMITS.DATE_PATTERN.test(params.targetDate)
    ? params.targetDate
    : '2026-01-01';

  return {
    id: safeId,
    actorId: params.actorId,
    actorName: safeActorName,
    deviceId: safeDeviceId,
    audience: NOTIFICATION_LIMITS.AUDIENCE,
    action: safeAction,
    summary: safeSummary,
    targetDate: safeDate,
  };
}

/**
 * Counts unread notifications that originated from another device/account after lastReadAtMs.
 */
export function countUnreadNotifications(
  items: ActivityNotificationItem[],
  lastReadAtMs: number,
  currentDeviceId: string
): number {
  let count = 0;
  for (const item of items) {
    if (item.deviceId === currentDeviceId) continue;
    if (item.createdAtMs > lastReadAtMs) {
      count += 1;
    }
  }
  return count;
}

export function isNotificationUnread(
  item: ActivityNotificationItem,
  lastReadAtMs: number,
  currentDeviceId: string
): boolean {
  return item.deviceId !== currentDeviceId && item.createdAtMs > lastReadAtMs;
}

export function formatRelativeTime(epochMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return 'Just now';
  const diffSec = Math.max(0, Math.floor((nowMs - epochMs) / 1000));
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(epochMs).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function getNotificationActionLabel(action: NotificationAction): string {
  switch (action) {
    case 'entry_added':
      return 'New Entry';
    case 'entry_updated':
      return 'Updated Entry';
    case 'entry_deleted':
      return 'Deleted Entry';
    case 'entries_reordered':
      return 'Reordered Entries';
    case 'opening_saved':
      return 'Opening Balances';
    case 'opening_reset':
      return 'Opening Reset';
    case 'ledger_imported':
      return 'Excel Import';
    case 'ledger_cleared':
      return 'Ledger Cleared';
    case 'project_updated':
      return 'Project Setup';
    case 'subko_requested':
      return 'Sub-KO Verification';
    case 'subko_approved':
      return 'Sub-KO Approved';
    case 'subko_declined':
      return 'Sub-KO Declined';
  }
}

export async function broadcastChangeNotification(
  user: User,
  deviceId: string,
  params: {
    action: NotificationAction;
    summary: string;
    targetDate: string;
  }
): Promise<void> {
  const id = `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sanitized = sanitizeNotificationPayload({
    id,
    actorId: user.uid,
    actorName: sanitizeActorName(user.displayName, user.email),
    deviceId,
    action: params.action,
    summary: params.summary,
    targetDate: params.targetDate,
  });

  const path = `notifications/${sanitized.id}`;
  try {
    await setDoc(doc(db, 'notifications', sanitized.id), {
      ...sanitized,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export interface BroadcastSubscriptionCallbacks {
  currentDeviceId: string;
  onFeedUpdate: (items: ActivityNotificationItem[]) => void;
  onRemoteIncoming: (item: ActivityNotificationItem) => void;
  onError: (err: Error) => void;
}

/**
 * Subscribes in real time to all broadcast notifications for logged-in devices.
 * Uses a single-field where('audience', '==', 'all_logged_in') query (no composite index needed)
 * and sorts newest-first in memory.
 */
export function subscribeToBroadcastNotifications(
  callbacks: BroadcastSubscriptionCallbacks
): Unsubscribe {
  const path = 'notifications';
  const notificationsQuery = query(
    collection(db, 'notifications'),
    where('audience', '==', NOTIFICATION_LIMITS.AUDIENCE)
  );

  let initialSnapshotHandled = false;
  const seenIds = new Set<string>();

  return onSnapshot(
    notificationsQuery,
    (snapshot) => {
      const items: ActivityNotificationItem[] = [];
      const newlyArrivedRemote: ActivityNotificationItem[] = [];

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const createdAtRaw = d.createdAt;
        const createdAtMs =
          createdAtRaw instanceof Timestamp
            ? createdAtRaw.toMillis()
            : typeof createdAtRaw === 'number'
              ? createdAtRaw
              : Date.now();

        const rawAction = String(d.action || 'entry_updated') as NotificationAction;
        const item: ActivityNotificationItem = {
          id: String(d.id || docSnap.id),
          actorId: String(d.actorId || ''),
          actorName: String(d.actorName || 'Team Member'),
          deviceId: String(d.deviceId || ''),
          audience: 'all_logged_in',
          action: ALLOWED_ACTIONS.has(rawAction) ? rawAction : 'entry_updated',
          summary: String(d.summary || ''),
          targetDate: String(d.targetDate || ''),
          createdAtMs,
        };

        items.push(item);

        if (initialSnapshotHandled && !seenIds.has(item.id)) {
          if (item.deviceId !== callbacks.currentDeviceId) {
            newlyArrivedRemote.push(item);
          }
        }
        seenIds.add(item.id);
      });

      items.sort((a, b) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id));
      const trimmed = items.slice(0, NOTIFICATION_LIMITS.MAX_FEED_ITEMS);

      initialSnapshotHandled = true;
      callbacks.onFeedUpdate(trimmed);

      if (newlyArrivedRemote.length > 0) {
        newlyArrivedRemote.sort((a, b) => b.createdAtMs - a.createdAtMs);
        callbacks.onRemoteIncoming(newlyArrivedRemote[0]);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

/**
 * Subscribes to the owner-private notification read cursor so "Mark all read" syncs across
 * all devices signed into the same account.
 */
export function subscribeToNotificationReadState(
  uid: string,
  callbacks: {
    onReadCursor: (lastReadAtMs: number) => void;
    onError: (err: Error) => void;
  }
): Unsubscribe {
  const path = `users/${uid}/notificationState/default`;
  const ref = doc(db, 'users', uid, 'notificationState', 'default');

  return onSnapshot(
    ref,
    (docSnap) => {
      if (!docSnap.exists()) {
        callbacks.onReadCursor(0);
        return;
      }
      const val = Number(docSnap.data().lastReadAtMs);
      callbacks.onReadCursor(Number.isFinite(val) && val >= 0 ? val : 0);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function saveNotificationReadState(
  uid: string,
  lastReadAtMs: number
): Promise<void> {
  const safeMs = Math.max(0, Math.min(9999999999999, Math.floor(lastReadAtMs)));
  const path = `users/${uid}/notificationState/default`;
  const ref = doc(db, 'users', uid, 'notificationState', 'default');

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        lastReadAtMs: safeMs,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: 'default',
        ownerId: uid,
        lastReadAtMs: safeMs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
