import type { AppState } from '../types/ledger';
import { isPrimaryOwnerEmail } from './ownership';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;

export interface EntryDocMeta {
  id: string;
  ownerId: string;
}

export interface OverrideDocMeta {
  id: string;
  ownerId: string;
}

export interface NotificationDocMeta {
  id: string;
  actorId: string;
}

export interface SubKoRequestDocMeta {
  id: string;
  requestedByUid: string;
  status: string;
}

export interface DatabasePurgePlan {
  entryIds: string[];
  overrideDates: string[];
  notificationIds: string[];
  subKoRequestIds: string[];
  totalCount: number;
}

function isValidDocId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_PATTERN.test(id);
}

/**
 * Computes the deduplicated set of Firestore document IDs the signed-in user is
 * authorized to delete under firestore.rules across ledger entries, opening overrides,
 * authored notifications, and Sub-KO requests.
 */
export function planAuthorizedPurgeTargets(params: {
  uid: string;
  email?: string | null;
  cloudEntries: EntryDocMeta[];
  cloudOverrides: OverrideDocMeta[];
  cloudNotifications: NotificationDocMeta[];
  cloudSubKoRequests: SubKoRequestDocMeta[];
  localState?: AppState;
}): DatabasePurgePlan {
  const { uid, email, cloudEntries, cloudOverrides, cloudNotifications, cloudSubKoRequests, localState } =
    params;

  const entryIdSet = new Set<string>();
  for (const doc of cloudEntries) {
    if (doc.ownerId === uid && isValidDocId(doc.id)) {
      entryIdSet.add(doc.id);
    }
  }
  if (localState) {
    for (const list of Object.values(localState.entriesByDate)) {
      for (const entry of list) {
        const cleaned = (entry.id || '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
        if (isValidDocId(cleaned)) {
          entryIdSet.add(cleaned);
        }
      }
    }
  }

  const overrideDateSet = new Set<string>();
  for (const doc of cloudOverrides) {
    if (doc.ownerId === uid && DATE_PATTERN.test(doc.id)) {
      overrideDateSet.add(doc.id);
    }
  }
  if (localState) {
    for (const dateKey of Object.keys(localState.openingOverrides)) {
      if (DATE_PATTERN.test(dateKey)) {
        overrideDateSet.add(dateKey);
      }
    }
  }

  const notificationIdSet = new Set<string>();
  for (const doc of cloudNotifications) {
    if (doc.actorId === uid && isValidDocId(doc.id)) {
      notificationIdSet.add(doc.id);
    }
  }

  const isKO = isPrimaryOwnerEmail(email);
  const subKoIdSet = new Set<string>();
  for (const doc of cloudSubKoRequests) {
    if (!isValidDocId(doc.id)) continue;
    if (isKO || (doc.requestedByUid === uid && doc.status === 'pending')) {
      subKoIdSet.add(doc.id);
    }
  }

  const entryIds = Array.from(entryIdSet);
  const overrideDates = Array.from(overrideDateSet);
  const notificationIds = Array.from(notificationIdSet);
  const subKoRequestIds = Array.from(subKoIdSet);

  return {
    entryIds,
    overrideDates,
    notificationIds,
    subKoRequestIds,
    totalCount:
      entryIds.length + overrideDates.length + notificationIds.length + subKoRequestIds.length,
  };
}
