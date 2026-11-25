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
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreErrors';
import { sanitizeActorName } from './firestoreNotifications';
import {
  createDefaultProjectConfig,
  evaluateLoginEligibility,
  isPrimaryOwnerEmail,
  isValidGmailAddress,
  normalizeGmailAddress,
  OWNERSHIP_LIMITS,
  PRIMARY_OWNER_KO_EMAIL,
  type AnimationPreset,
  type LoginEligibilityResult,
  type ProjectOwnershipConfig,
  type SubKoRequestRecord,
  type SubKoStatus,
} from './ownership';

const ALLOWED_PRESETS = new Set<AnimationPreset>([
  'none',
  'pulse_orbit',
  'ledger_flow',
  'emerald_wave',
]);
const ALLOWED_STATUSES = new Set<SubKoStatus>(['pending', 'approved', 'declined']);

function toEpochMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return Date.now();
}

export function subscribeToProjectConfig(callbacks: {
  onConfig: (config: ProjectOwnershipConfig) => void;
  onError: (err: Error) => void;
}): Unsubscribe {
  const path = 'projectConfig/default';
  const ref = doc(db, 'projectConfig', 'default');

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        callbacks.onConfig(createDefaultProjectConfig());
        return;
      }
      const d = snap.data();
      const preset = String(d.animationPreset || 'pulse_orbit') as AnimationPreset;
      callbacks.onConfig({
        id: 'default',
        primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
        animationPreset: ALLOWED_PRESETS.has(preset) ? preset : 'pulse_orbit',
        animationTitle: String(d.animationTitle || '').slice(
          0,
          OWNERSHIP_LIMITS.MAX_ANIMATION_TITLE_LEN
        ),
        updatedByUid: String(d.updatedByUid || ''),
        updatedAtMs: toEpochMs(d.updatedAt),
      });
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

export async function saveProjectAnimationInFirestore(
  user: User,
  animationPreset: AnimationPreset,
  animationTitle: string
): Promise<void> {
  const safePreset: AnimationPreset = ALLOWED_PRESETS.has(animationPreset)
    ? animationPreset
    : 'pulse_orbit';
  const safeTitle = animationTitle.trim().slice(0, OWNERSHIP_LIMITS.MAX_ANIMATION_TITLE_LEN);
  const path = 'projectConfig/default';
  const ref = doc(db, 'projectConfig', 'default');

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        animationPreset: safePreset,
        animationTitle: safeTitle,
        updatedByUid: user.uid,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: 'default',
        primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
        animationPreset: safePreset,
        animationTitle: safeTitle,
        updatedByUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToSubKoRequests(
  user: User,
  callbacks: {
    onRequests: (requests: SubKoRequestRecord[]) => void;
    onError: (err: Error) => void;
  }
): Unsubscribe {
  const path = 'subKoRequests';
  const isKO = isPrimaryOwnerEmail(user.email);

  // Rules enforce strict scoping: Primary Owner (KO) sees all requests addressed to KO;
  // other signed-in users see requests they submitted (or targeting their email).
  const reqQuery = isKO
    ? query(
        collection(db, 'subKoRequests'),
        where('primaryOwnerEmail', '==', PRIMARY_OWNER_KO_EMAIL)
      )
    : query(collection(db, 'subKoRequests'), where('requestedByUid', '==', user.uid));

  return onSnapshot(
    reqQuery,
    (snapshot) => {
      const items: SubKoRequestRecord[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const rawStatus = String(d.status || 'pending') as SubKoStatus;
        items.push({
          id: String(d.id || docSnap.id),
          subKoEmail: normalizeGmailAddress(String(d.subKoEmail || '')),
          requestedByUid: String(d.requestedByUid || ''),
          requestedByName: String(d.requestedByName || 'Team Member'),
          primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
          status: ALLOWED_STATUSES.has(rawStatus) ? rawStatus : 'pending',
          reviewedByUid: d.reviewedByUid ? String(d.reviewedByUid) : null,
          createdAtMs: toEpochMs(d.createdAt),
          updatedAtMs: toEpochMs(d.updatedAt),
        });
      });
      items.sort((a, b) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id));
      callbacks.onRequests(items);
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

export async function createSubKoVerificationRequestInFirestore(
  user: User,
  gmailAddress: string
): Promise<string> {
  const normalizedEmail = normalizeGmailAddress(gmailAddress);
  const id = `subko_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `subKoRequests/${id}`;

  try {
    await setDoc(doc(db, 'subKoRequests', id), {
      id,
      subKoEmail: normalizedEmail,
      requestedByUid: user.uid,
      requestedByName: sanitizeActorName(user.displayName, user.email).slice(
        0,
        OWNERSHIP_LIMITS.MAX_REQUESTER_NAME_LEN
      ),
      primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
      status: 'pending',
      reviewedByUid: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function reviewSubKoRequestInFirestore(
  user: User,
  requestId: string,
  decision: 'approved' | 'declined'
): Promise<void> {
  const safeId = requestId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  const path = `subKoRequests/${safeId}`;
  try {
    await updateDoc(doc(db, 'subKoRequests', safeId), {
      status: decision,
      reviewedByUid: user.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cancelSubKoRequestInFirestore(requestId: string): Promise<void> {
  const safeId = requestId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  const path = `subKoRequests/${safeId}`;
  try {
    await deleteDoc(doc(db, 'subKoRequests', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function verifyRegisteredGmailInFirestore(
  user: User
): Promise<LoginEligibilityResult> {
  const normalizedEmail = normalizeGmailAddress(user.email || '');

  // Fast-path: reject unverified or non-Gmail accounts immediately, and allow Primary Owner KO
  if (!user.emailVerified || !isValidGmailAddress(normalizedEmail) || isPrimaryOwnerEmail(normalizedEmail)) {
    return evaluateLoginEligibility({
      email: normalizedEmail,
      emailVerified: Boolean(user.emailVerified),
    });
  }

  let hasRegisteredProfile = false;
  let hasApprovedSubKo = false;
  let hasPendingSubKo = false;

  const [profileResult, subKoResult] = await Promise.allSettled([
    getDoc(doc(db, 'users', user.uid)),
    getDocs(query(collection(db, 'subKoRequests'), where('subKoEmail', '==', normalizedEmail))),
  ]);

  if (profileResult.status === 'fulfilled' && profileResult.value.exists()) {
    const profileEmail = normalizeGmailAddress(String(profileResult.value.data().email || ''));
    if (profileEmail === normalizedEmail) {
      hasRegisteredProfile = true;
    }
  } else if (profileResult.status === 'rejected') {
    try {
      handleFirestoreError(profileResult.reason, OperationType.GET, `users/${user.uid}`);
    } catch (wrapped) {
      console.warn('Could not verify registered profile during sign-in:', wrapped);
    }
  }

  if (subKoResult.status === 'fulfilled') {
    subKoResult.value.forEach((docSnap) => {
      const status = String(docSnap.data().status || '');
      if (status === 'approved') hasApprovedSubKo = true;
      if (status === 'pending') hasPendingSubKo = true;
    });
  } else if (subKoResult.status === 'rejected') {
    try {
      handleFirestoreError(subKoResult.reason, OperationType.LIST, 'subKoRequests');
    } catch (wrapped) {
      console.warn('Could not verify Sub-KO authorization during sign-in:', wrapped);
    }
  }

  return evaluateLoginEligibility({
    email: normalizedEmail,
    emailVerified: Boolean(user.emailVerified),
    hasRegisteredProfile,
    hasApprovedSubKo,
    hasPendingSubKo,
  });
}
