import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { GROUP_ORDER } from '../data/groups';
import type {
  AppState,
  BalanceSnapshot,
  BusinessGroupName,
  LogEntry,
  PaymentMode,
} from '../types/ledger';
import { round2 } from '../utils/accounting';
import { planAuthorizedPurgeTargets } from './databasePurge';
import { db } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreErrors';
import { isPrimaryOwnerEmail, PRIMARY_OWNER_KO_EMAIL } from './ownership';
import {
  detectRemoteEntrySyncEvents,
  type FirestoreEntryDocChange,
  type RemoteEntrySyncEvent,
} from './remoteSyncTrigger';

// Blueprint-synchronized validation constants (matches firebase-blueprint.json & firestore.rules)
export const BLUEPRINT_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
  MAX_ID_LEN: 128,
  MAX_DEVICE_ID_LEN: 64,
  MAX_DISPLAY_NAME_LEN: 120,
  MAX_EMAIL_LEN: 254,
  MAX_SERVICE_TYPE_LEN: 120,
  MAX_REMARKS_LEN: 300,
  MAX_ORDER_INDEX: 100000,
  MAX_AMOUNT: 1000000000,
  BATCH_CHUNK_SIZE: 400,
} as const;

const ALLOWED_GROUPS = new Set<string>(GROUP_ORDER);
const ALLOWED_MODES = new Set<PaymentMode>(['Cash', 'ONLINE', 'CREDIT']);

export function sanitizeId(raw: string): string {
  const cleaned = (raw || '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, BLUEPRINT_LIMITS.MAX_ID_LEN);
  if (cleaned.length > 0 && BLUEPRINT_LIMITS.ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampAmount(n: number, allowNegative: boolean): number {
  const rounded = round2(Number.isFinite(n) ? n : 0);
  const min = allowNegative ? -BLUEPRINT_LIMITS.MAX_AMOUNT : 0;
  return Math.max(min, Math.min(BLUEPRINT_LIMITS.MAX_AMOUNT, rounded));
}

function sanitizeCustomDeltas(deltas: BalanceSnapshot | null | undefined): BalanceSnapshot | null {
  if (!deltas) return null;
  return {
    ko: clampAmount(deltas.ko, true),
    cash: clampAmount(deltas.cash, true),
    fino: clampAmount(deltas.fino, true),
    airtel: clampAmount(deltas.airtel, true),
    bank: clampAmount(deltas.bank, true),
    credit: clampAmount(deltas.credit, true),
  };
}

export function sanitizeOptionalDeviceId(deviceId?: string | null): string | null {
  if (!deviceId) return null;
  const cleaned = deviceId
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, BLUEPRINT_LIMITS.MAX_DEVICE_ID_LEN);
  if (cleaned.length >= 1 && BLUEPRINT_LIMITS.ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export function sanitizeLedgerEntryForFirestore(
  ownerId: string,
  entry: LogEntry,
  orderIndex: number,
  deviceId?: string | null
) {
  const id = sanitizeId(entry.id);
  const safeGroup: BusinessGroupName = ALLOWED_GROUPS.has(entry.type)
    ? (entry.type as BusinessGroupName)
    : 'SHOP';
  const safeMode: PaymentMode = ALLOWED_MODES.has(entry.paymentMode as PaymentMode)
    ? (entry.paymentMode as PaymentMode)
    : 'Cash';
  const safeService =
    (entry.serviceType || 'GENERAL ENTRY').trim().slice(0, BLUEPRINT_LIMITS.MAX_SERVICE_TYPE_LEN) ||
    'GENERAL ENTRY';
  const safeRemarks = (entry.remarks || '').trim().slice(0, BLUEPRINT_LIMITS.MAX_REMARKS_LEN);
  const safeDate = BLUEPRINT_LIMITS.DATE_PATTERN.test(entry.date) ? entry.date : '2026-01-01';
  const safeOrder = Math.max(0, Math.min(BLUEPRINT_LIMITS.MAX_ORDER_INDEX, Math.floor(orderIndex)));
  const safeDeviceId = sanitizeOptionalDeviceId(deviceId);

  return {
    id,
    ownerId,
    date: safeDate,
    orderIndex: safeOrder,
    type: safeGroup,
    serviceType: safeService,
    remarks: safeRemarks,
    paymentMode: safeMode,
    debit: clampAmount(entry.debit, false),
    credit: clampAmount(entry.credit, false),
    customDeltas: sanitizeCustomDeltas(entry.customDeltas),
    lastModifiedByDeviceId: safeDeviceId,
  };
}

export function sanitizeOpeningOverrideForFirestore(
  ownerId: string,
  dateISO: string,
  balances: BalanceSnapshot
) {
  return {
    date: dateISO,
    ownerId,
    ko: clampAmount(balances.ko, true),
    cash: clampAmount(balances.cash, true),
    fino: clampAmount(balances.fino, true),
    airtel: clampAmount(balances.airtel, true),
    bank: clampAmount(balances.bank, true),
    credit: clampAmount(balances.credit, true),
  };
}

/**
 * Ensures the parent /users/{uid} document exists before any subcollection writes.
 */
export async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const email = (user.email || '').trim().slice(0, BLUEPRINT_LIMITS.MAX_EMAIL_LEN);
  const displayName = (user.displayName || email.split('@')[0] || 'Shop Owner')
    .trim()
    .slice(0, BLUEPRINT_LIMITS.MAX_DISPLAY_NAME_LEN);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email,
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data();
      if (existing.email !== email || existing.displayName !== displayName) {
        await updateDoc(ref, {
          email,
          displayName,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface LedgerSnapshotCallbacks {
  currentDeviceId?: string;
  onSnapshotUpdate: (
    entriesByDate: Record<string, LogEntry[]>,
    openingOverrides: Record<string, BalanceSnapshot>,
    meta: { entriesLoaded: boolean; overridesLoaded: boolean }
  ) => void;
  onRemoteEntryChanges?: (events: RemoteEntrySyncEvent[]) => void;
  onError: (err: Error) => void;
}

function parseEntryFromFirestoreData(docId: string, d: Record<string, unknown>): LogEntry | null {
  const date = String(d.date || '');
  if (!BLUEPRINT_LIMITS.DATE_PATTERN.test(date)) return null;
  return {
    id: String(d.id || docId),
    date,
    type: String(d.type || 'SHOP'),
    serviceType: String(d.serviceType || ''),
    remarks: String(d.remarks || ''),
    paymentMode: (d.paymentMode as PaymentMode) || 'Cash',
    debit: Number(d.debit) || 0,
    credit: Number(d.credit) || 0,
    customDeltas: d.customDeltas ? (d.customDeltas as BalanceSnapshot) : null,
  };
}

function extractTimestampMs(raw: unknown): number {
  if (raw instanceof Timestamp) return raw.toMillis();
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return Date.now();
}

/**
 * Subscribes in real time to the authenticated user's entries and opening balance overrides,
 * and triggers onRemoteEntryChanges whenever a remote device adds or updates an entry.
 */
export function subscribeToUserLedger(
  uid: string,
  callbacks: LedgerSnapshotCallbacks
): Unsubscribe {
  let latestEntries: Record<string, LogEntry[]> = {};
  let latestOverrides: Record<string, BalanceSnapshot> = {};
  let entriesLoaded = false;
  let overridesLoaded = false;
  let previousEntriesById = new Map<string, LogEntry>();

  const emit = () => {
    callbacks.onSnapshotUpdate(latestEntries, latestOverrides, {
      entriesLoaded,
      overridesLoaded,
    });
  };

  const entriesPath = `users/${uid}/entries`;
  const entriesQuery = query(collection(db, 'users', uid, 'entries'), where('ownerId', '==', uid));

  const unsubEntries = onSnapshot(
    entriesQuery,
    (snapshot) => {
      const grouped = new Map<string, Array<{ entry: LogEntry; orderIndex: number }>>();
      const nextEntriesById = new Map<string, LogEntry>();

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const entry = parseEntryFromFirestoreData(docSnap.id, d);
        if (!entry) return;
        nextEntriesById.set(entry.id, entry);
        const orderIndex = typeof d.orderIndex === 'number' ? d.orderIndex : 0;
        const list = grouped.get(entry.date) || [];
        list.push({ entry, orderIndex });
        grouped.set(entry.date, list);
      });

      const docChanges: FirestoreEntryDocChange[] = [];
      for (const change of snapshot.docChanges()) {
        const d = change.doc.data();
        const entry = parseEntryFromFirestoreData(change.doc.id, d);
        if (!entry) continue;
        docChanges.push({
          changeType: change.type,
          hasPendingWrites: change.doc.metadata.hasPendingWrites,
          entry,
          lastModifiedByDeviceId:
            typeof d.lastModifiedByDeviceId === 'string' ? d.lastModifiedByDeviceId : null,
          updatedAtMs: extractTimestampMs(d.updatedAt ?? d.createdAt),
        });
      }

      const remoteEvents = callbacks.onRemoteEntryChanges
        ? detectRemoteEntrySyncEvents({
            initialSnapshotHandled: entriesLoaded,
            snapshotHasPendingWrites: snapshot.metadata.hasPendingWrites,
            currentDeviceId: callbacks.currentDeviceId || '',
            previousEntriesById,
            changes: docChanges,
          })
        : [];

      const nextEntries: Record<string, LogEntry[]> = {};
      for (const [date, items] of grouped.entries()) {
        items.sort((a, b) => a.orderIndex - b.orderIndex || a.entry.id.localeCompare(b.entry.id));
        nextEntries[date] = items.map((x) => x.entry);
      }

      previousEntriesById = nextEntriesById;
      latestEntries = nextEntries;
      entriesLoaded = true;
      emit();

      if (remoteEvents.length > 0 && callbacks.onRemoteEntryChanges) {
        callbacks.onRemoteEntryChanges(remoteEvents);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, entriesPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  const overridesPath = `users/${uid}/openingOverrides`;
  const overridesQuery = query(
    collection(db, 'users', uid, 'openingOverrides'),
    where('ownerId', '==', uid)
  );

  const unsubOverrides = onSnapshot(
    overridesQuery,
    (snapshot) => {
      const nextOverrides: Record<string, BalanceSnapshot> = {};
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const date = String(d.date || docSnap.id);
        if (!BLUEPRINT_LIMITS.DATE_PATTERN.test(date)) return;
        nextOverrides[date] = {
          ko: Number(d.ko) || 0,
          cash: Number(d.cash) || 0,
          fino: Number(d.fino) || 0,
          airtel: Number(d.airtel) || 0,
          bank: Number(d.bank) || 0,
          credit: Number(d.credit) || 0,
        };
      });

      latestOverrides = nextOverrides;
      overridesLoaded = true;
      emit();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, overridesPath);
      } catch (wrapped) {
        callbacks.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  return () => {
    unsubEntries();
    unsubOverrides();
  };
}

export async function createLedgerEntryInFirestore(
  uid: string,
  entry: LogEntry,
  orderIndex: number,
  deviceId?: string
): Promise<void> {
  const sanitized = sanitizeLedgerEntryForFirestore(uid, entry, orderIndex, deviceId);
  const path = `users/${uid}/entries/${sanitized.id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'entries', sanitized.id), {
      ...sanitized,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateLedgerEntryInFirestore(
  uid: string,
  entry: LogEntry,
  orderIndex: number,
  deviceId?: string
): Promise<void> {
  const sanitized = sanitizeLedgerEntryForFirestore(uid, entry, orderIndex, deviceId);
  const path = `users/${uid}/entries/${sanitized.id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'entries', sanitized.id), {
      date: sanitized.date,
      type: sanitized.type,
      serviceType: sanitized.serviceType,
      remarks: sanitized.remarks,
      paymentMode: sanitized.paymentMode,
      debit: sanitized.debit,
      credit: sanitized.credit,
      customDeltas: sanitized.customDeltas,
      lastModifiedByDeviceId: sanitized.lastModifiedByDeviceId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteLedgerEntryInFirestore(uid: string, entryId: string): Promise<void> {
  const safeId = sanitizeId(entryId);
  const path = `users/${uid}/entries/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'entries', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function reorderDayEntriesInFirestore(
  uid: string,
  orderedEntryIds: string[],
  deviceId?: string
): Promise<void> {
  const path = `users/${uid}/entries`;
  const safeDeviceId = sanitizeOptionalDeviceId(deviceId);
  try {
    for (let i = 0; i < orderedEntryIds.length; i += BLUEPRINT_LIMITS.BATCH_CHUNK_SIZE) {
      const chunk = orderedEntryIds.slice(i, i + BLUEPRINT_LIMITS.BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((entryId, offset) => {
        const safeId = sanitizeId(entryId);
        batch.update(doc(db, 'users', uid, 'entries', safeId), {
          orderIndex: i + offset,
          lastModifiedByDeviceId: safeDeviceId,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveOpeningOverrideInFirestore(
  uid: string,
  dateISO: string,
  balances: BalanceSnapshot,
  _alreadyExists: boolean
): Promise<void> {
  if (!BLUEPRINT_LIMITS.DATE_PATTERN.test(dateISO)) {
    throw new Error(`Invalid date format for opening override: ${dateISO}`);
  }
  const sanitized = sanitizeOpeningOverrideForFirestore(uid, dateISO, balances);
  const path = `users/${uid}/openingOverrides/${dateISO}`;
  const ref = doc(db, 'users', uid, 'openingOverrides', dateISO);
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        ko: sanitized.ko,
        cash: sanitized.cash,
        fino: sanitized.fino,
        airtel: sanitized.airtel,
        bank: sanitized.bank,
        credit: sanitized.credit,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...sanitized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteOpeningOverrideInFirestore(
  uid: string,
  dateISO: string
): Promise<void> {
  if (!BLUEPRINT_LIMITS.DATE_PATTERN.test(dateISO)) {
    throw new Error(`Invalid date format for opening override: ${dateISO}`);
  }
  const path = `users/${uid}/openingOverrides/${dateISO}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'openingOverrides', dateISO));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

type BatchAction =
  | { kind: 'setEntry'; entry: LogEntry; orderIndex: number }
  | { kind: 'deleteEntry'; id: string }
  | { kind: 'setOverride'; date: string; balances: BalanceSnapshot; exists: boolean }
  | { kind: 'deleteOverride'; date: string }
  | { kind: 'deleteNotification'; id: string }
  | { kind: 'deleteSubKoRequest'; id: string };

async function executeChunkedBatch(
  uid: string,
  actions: BatchAction[],
  path: string,
  deviceId?: string
) {
  try {
    for (let i = 0; i < actions.length; i += BLUEPRINT_LIMITS.BATCH_CHUNK_SIZE) {
      const chunk = actions.slice(i, i + BLUEPRINT_LIMITS.BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const act of chunk) {
        if (act.kind === 'setEntry') {
          const sanitized = sanitizeLedgerEntryForFirestore(
            uid,
            act.entry,
            act.orderIndex,
            deviceId
          );
          batch.set(doc(db, 'users', uid, 'entries', sanitized.id), {
            ...sanitized,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else if (act.kind === 'deleteEntry') {
          batch.delete(doc(db, 'users', uid, 'entries', sanitizeId(act.id)));
        } else if (act.kind === 'setOverride') {
          if (!BLUEPRINT_LIMITS.DATE_PATTERN.test(act.date)) continue;
          const sanitized = sanitizeOpeningOverrideForFirestore(uid, act.date, act.balances);
          const ref = doc(db, 'users', uid, 'openingOverrides', act.date);
          if (act.exists) {
            batch.update(ref, {
              ko: sanitized.ko,
              cash: sanitized.cash,
              fino: sanitized.fino,
              airtel: sanitized.airtel,
              bank: sanitized.bank,
              credit: sanitized.credit,
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.set(ref, {
              ...sanitized,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } else if (act.kind === 'deleteOverride') {
          if (!BLUEPRINT_LIMITS.DATE_PATTERN.test(act.date)) continue;
          batch.delete(doc(db, 'users', uid, 'openingOverrides', act.date));
        } else if (act.kind === 'deleteNotification') {
          batch.delete(doc(db, 'notifications', sanitizeId(act.id)));
        } else if (act.kind === 'deleteSubKoRequest') {
          batch.delete(doc(db, 'subKoRequests', sanitizeId(act.id)));
        }
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface ClearDatabaseResult {
  deletedCount: number;
  entriesDeleted: number;
  overridesDeleted: number;
  notificationsDeleted: number;
  subKoRequestsDeleted: number;
}

export async function clearAllLedgerDataInFirestore(
  uid: string,
  state: AppState,
  userEmail?: string | null
): Promise<ClearDatabaseResult> {
  const isKO = isPrimaryOwnerEmail(userEmail);

  const [entriesSnap, overridesSnap, notificationsRes, subKoRes] = await Promise.all([
    getDocs(query(collection(db, 'users', uid, 'entries'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'users', uid, 'openingOverrides'), where('ownerId', '==', uid))),
    getDocs(
      query(collection(db, 'notifications'), where('audience', '==', 'all_logged_in'))
    ).catch(() => null),
    getDocs(
      isKO
        ? query(
            collection(db, 'subKoRequests'),
            where('primaryOwnerEmail', '==', PRIMARY_OWNER_KO_EMAIL)
          )
        : query(collection(db, 'subKoRequests'), where('requestedByUid', '==', uid))
    ).catch(() => null),
  ]);

  const cloudEntries = entriesSnap.docs.map((d) => ({
    id: d.id,
    ownerId: String(d.data().ownerId || ''),
  }));
  const cloudOverrides = overridesSnap.docs.map((d) => ({
    id: d.id,
    ownerId: String(d.data().ownerId || ''),
  }));
  const cloudNotifications = notificationsRes
    ? notificationsRes.docs.map((d) => ({
        id: d.id,
        actorId: String(d.data().actorId || ''),
      }))
    : [];
  const cloudSubKoRequests = subKoRes
    ? subKoRes.docs.map((d) => ({
        id: d.id,
        requestedByUid: String(d.data().requestedByUid || ''),
        status: String(d.data().status || ''),
      }))
    : [];

  const plan = planAuthorizedPurgeTargets({
    uid,
    email: userEmail,
    cloudEntries,
    cloudOverrides,
    cloudNotifications,
    cloudSubKoRequests,
    localState: state,
  });

  const actions: BatchAction[] = [
    ...plan.entryIds.map((id) => ({ kind: 'deleteEntry' as const, id })),
    ...plan.overrideDates.map((date) => ({ kind: 'deleteOverride' as const, date })),
    ...plan.notificationIds.map((id) => ({ kind: 'deleteNotification' as const, id })),
    ...plan.subKoRequestIds.map((id) => ({ kind: 'deleteSubKoRequest' as const, id })),
  ];

  if (actions.length > 0) {
    await executeChunkedBatch(uid, actions, `users/${uid}`);
  }

  return {
    deletedCount: plan.totalCount,
    entriesDeleted: plan.entryIds.length,
    overridesDeleted: plan.overrideDates.length,
    notificationsDeleted: plan.notificationIds.length,
    subKoRequestsDeleted: plan.subKoRequestIds.length,
  };
}

export async function importLedgerStateToFirestore(
  uid: string,
  incomingEntriesByDate: Record<string, LogEntry[]>,
  incomingOverrides: Record<string, BalanceSnapshot>,
  currentState: AppState,
  mode: 'replace' | 'merge',
  deviceId?: string
): Promise<void> {
  const deleteActions: BatchAction[] = [];
  const writeActions: BatchAction[] = [];
  const existingEntryIds = new Set<string>();

  for (const list of Object.values(currentState.entriesByDate)) {
    for (const entry of list) {
      existingEntryIds.add(sanitizeId(entry.id));
    }
  }

  if (mode === 'replace') {
    for (const list of Object.values(currentState.entriesByDate)) {
      for (const entry of list) {
        deleteActions.push({ kind: 'deleteEntry', id: entry.id });
      }
    }
    for (const date of Object.keys(currentState.openingOverrides)) {
      if (BLUEPRINT_LIMITS.DATE_PATTERN.test(date) && !incomingOverrides[date]) {
        deleteActions.push({ kind: 'deleteOverride', date });
      }
    }
  }

  if (deleteActions.length > 0) {
    await executeChunkedBatch(uid, deleteActions, `users/${uid}`, deviceId);
  }

  const usedIds = mode === 'merge' ? new Set(existingEntryIds) : new Set<string>();

  for (const [date, list] of Object.entries(incomingEntriesByDate)) {
    if (!BLUEPRINT_LIMITS.DATE_PATTERN.test(date)) continue;
    const baseOffset = mode === 'merge' ? (currentState.entriesByDate[date]?.length ?? 0) : 0;
    list.forEach((entry, idx) => {
      let safeEntry = entry;
      const candidateId = sanitizeId(entry.id);
      if (usedIds.has(candidateId)) {
        const freshId = sanitizeId(`${candidateId}_${Date.now()}_${idx}`);
        safeEntry = { ...entry, id: freshId };
        usedIds.add(freshId);
      } else {
        usedIds.add(candidateId);
      }
      writeActions.push({ kind: 'setEntry', entry: safeEntry, orderIndex: baseOffset + idx });
    });
  }

  for (const [date, balances] of Object.entries(incomingOverrides)) {
    if (!BLUEPRINT_LIMITS.DATE_PATTERN.test(date)) continue;
    const exists = Boolean(currentState.openingOverrides[date]);
    writeActions.push({ kind: 'setOverride', date, balances, exists });
  }

  if (writeActions.length === 0) return;
  await executeChunkedBatch(uid, writeActions, `users/${uid}`, deviceId);
}
