import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_TEXT = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_GROUPS = new Set([
  'SBI CSP',
  'AIRTEL CSP',
  'INSTANTPAY',
  'SHOP',
  'Kerala House',
  'Tehrik e Jadeed',
  'EXPENSE',
  'FINO',
]);
const ALLOWED_MODES = new Set(['Cash', 'ONLINE', 'CREDIT']);
const ALLOWED_NOTIFICATION_ACTIONS = new Set([
  'entry_added',
  'entry_updated',
  'entry_deleted',
  'entries_reordered',
  'opening_saved',
  'opening_reset',
  'ledger_imported',
  'ledger_cleared',
]);

interface MockAuth {
  uid: string;
  token: { email: string; email_verified: boolean };
}

interface RuleContext {
  auth: MockAuth | null;
  requestTime: number;
  existingUserIds: Set<string>;
}

function isVerifiedUser(ctx: RuleContext): boolean {
  return Boolean(
    ctx.auth &&
      ctx.auth.token.email_verified === true &&
      /^[a-zA-Z0-9._%+\-]+@gmail\.com$/.test(ctx.auth.token.email)
  );
}

function isVerifiedOwner(ctx: RuleContext, userId: string): boolean {
  return isVerifiedUser(ctx) && ctx.auth?.uid === userId;
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_REGEX.test(id);
}

function isValidDeviceId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 64 && ID_REGEX.test(id);
}

function isValidCustomDeltas(d: unknown): boolean {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  const keys = Object.keys(d as Record<string, unknown>);
  const allowed = ['ko', 'cash', 'fino', 'airtel', 'bank', 'credit'];
  if (keys.length !== allowed.length || !allowed.every((k) => keys.includes(k))) return false;
  return allowed.every((k) => {
    const v = (d as Record<string, unknown>)[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= -1e9 && v <= 1e9;
  });
}

function evaluateEntryCreate(
  ctx: RuleContext,
  userId: string,
  entryId: string,
  data: Record<string, unknown>
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!isVerifiedOwner(ctx, userId)) return 'PERMISSION_DENIED';
  if (!isValidId(userId) || !isValidId(entryId)) return 'PERMISSION_DENIED';
  if (!ctx.existingUserIds.has(userId)) return 'PERMISSION_DENIED';

  const requiredKeys = [
    'id',
    'ownerId',
    'date',
    'orderIndex',
    'type',
    'serviceType',
    'remarks',
    'paymentMode',
    'debit',
    'credit',
    'createdAt',
    'updatedAt',
  ];
  const allowedKeys = new Set([...requiredKeys, 'customDeltas', 'lastModifiedByDeviceId']);
  const keys = Object.keys(data);
  if (!requiredKeys.every((k) => keys.includes(k))) return 'PERMISSION_DENIED';
  if (!keys.every((k) => allowedKeys.has(k))) return 'PERMISSION_DENIED';

  if (data.id !== entryId || data.ownerId !== userId || data.ownerId !== ctx.auth?.uid) {
    return 'PERMISSION_DENIED';
  }
  if (typeof data.date !== 'string' || !DATE_REGEX.test(data.date)) return 'PERMISSION_DENIED';
  if (typeof data.orderIndex !== 'number' || data.orderIndex < 0 || data.orderIndex > 100000) {
    return 'PERMISSION_DENIED';
  }
  if (typeof data.type !== 'string' || !ALLOWED_GROUPS.has(data.type)) return 'PERMISSION_DENIED';
  if (
    typeof data.serviceType !== 'string' ||
    data.serviceType.length < 1 ||
    data.serviceType.length > 120
  ) {
    return 'PERMISSION_DENIED';
  }
  if (typeof data.remarks !== 'string' || data.remarks.length > 300) return 'PERMISSION_DENIED';
  if (typeof data.paymentMode !== 'string' || !ALLOWED_MODES.has(data.paymentMode)) {
    return 'PERMISSION_DENIED';
  }
  if (typeof data.debit !== 'number' || data.debit < 0 || data.debit > 1e9) {
    return 'PERMISSION_DENIED';
  }
  if (typeof data.credit !== 'number' || data.credit < 0 || data.credit > 1e9) {
    return 'PERMISSION_DENIED';
  }
  if ('customDeltas' in data && data.customDeltas !== null && !isValidCustomDeltas(data.customDeltas)) {
    return 'PERMISSION_DENIED';
  }
  if (
    'lastModifiedByDeviceId' in data &&
    data.lastModifiedByDeviceId !== null &&
    !isValidDeviceId(data.lastModifiedByDeviceId)
  ) {
    return 'PERMISSION_DENIED';
  }
  if (data.createdAt !== ctx.requestTime || data.updatedAt !== ctx.requestTime) {
    return 'PERMISSION_DENIED';
  }
  return 'ALLOW';
}

function evaluateNotificationCreate(
  ctx: RuleContext,
  notificationId: string,
  data: Record<string, unknown>
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!isVerifiedUser(ctx) || !ctx.auth) return 'PERMISSION_DENIED';
  if (!isValidId(notificationId)) return 'PERMISSION_DENIED';
  if (!ctx.existingUserIds.has(ctx.auth.uid)) return 'PERMISSION_DENIED';

  const requiredKeys = [
    'id',
    'actorId',
    'actorName',
    'deviceId',
    'audience',
    'action',
    'summary',
    'targetDate',
    'createdAt',
  ];
  const allowedKeys = new Set(requiredKeys);
  const keys = Object.keys(data);
  if (!requiredKeys.every((k) => keys.includes(k))) return 'PERMISSION_DENIED';
  if (!keys.every((k) => allowedKeys.has(k))) return 'PERMISSION_DENIED';

  if (data.id !== notificationId) return 'PERMISSION_DENIED';
  if (!isValidId(data.actorId) || data.actorId !== ctx.auth.uid) return 'PERMISSION_DENIED';
  if (typeof data.actorName !== 'string' || data.actorName.length < 1 || data.actorName.length > 80) {
    return 'PERMISSION_DENIED';
  }
  if (!isValidDeviceId(data.deviceId)) return 'PERMISSION_DENIED';
  if (data.audience !== 'all_logged_in') return 'PERMISSION_DENIED';
  if (typeof data.action !== 'string' || !ALLOWED_NOTIFICATION_ACTIONS.has(data.action)) {
    return 'PERMISSION_DENIED';
  }
  if (typeof data.summary !== 'string' || data.summary.length < 1 || data.summary.length > 200) {
    return 'PERMISSION_DENIED';
  }
  if (typeof data.targetDate !== 'string' || !DATE_REGEX.test(data.targetDate)) {
    return 'PERMISSION_DENIED';
  }
  if (data.createdAt !== ctx.requestTime) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

test('firestore.rules contains all Eight Pillars structural guards including notifications', () => {
  assert.match(RULES_TEXT, /rules_version\s*=\s*'2';/);
  assert.match(RULES_TEXT, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.match(RULES_TEXT, /request\.auth\.token\.email_verified == true/);
  assert.match(RULES_TEXT, /allow list:\s*if false;/);
  assert.match(RULES_TEXT, /existing\(\)\.ownerId == request\.auth\.uid/);
  assert.match(RULES_TEXT, /existing\(\)\.audience == 'all_logged_in'/);
  assert.match(RULES_TEXT, /match \/notifications\/\{notificationId\}/);
  assert.match(RULES_TEXT, /match \/notificationState\/\{stateId\}/);
  assert.match(RULES_TEXT, /allow update:\s*if false;/);
  assert.match(RULES_TEXT, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly/);
  assert.match(RULES_TEXT, /parentUserExists\(userId\)/);
  assert.match(RULES_TEXT, /parentUserExists\(request\.auth\.uid\)/);
  assert.match(RULES_TEXT, /incoming\(\)\.createdAt == request\.time/);
  assert.match(RULES_TEXT, /incoming\(\)\.updatedAt == request\.time/);
});

test('Dirty Dozen adversarial payloads all return PERMISSION_DENIED for entries & notifications', () => {
  const now = 1764095000000;
  const verifiedCtx: RuleContext = {
    auth: { uid: 'user_1', token: { email: 'owner@gmail.com', email_verified: true } },
    requestTime: now,
    existingUserIds: new Set(['user_1']),
  };

  const validEntry: Record<string, unknown> = {
    id: 'txn_1',
    ownerId: 'user_1',
    date: '2026-11-25',
    orderIndex: 0,
    type: 'SBI CSP',
    serviceType: 'AEPS WITHDRAWAL',
    remarks: 'Shafeek',
    paymentMode: 'Cash',
    debit: 1000,
    credit: 0,
    customDeltas: null,
    createdAt: now,
    updatedAt: now,
  };

  const validNotification: Record<string, unknown> = {
    id: 'ntf_1',
    actorId: 'user_1',
    actorName: 'Shop Owner',
    deviceId: 'dev_abc123',
    audience: 'all_logged_in',
    action: 'entry_added',
    summary: 'Added SBI CSP · AEPS WITHDRAWAL (Dr 1,000.00)',
    targetDate: '2026-11-25',
    createdAt: now,
  };

  // Sanity checks: valid payloads succeed
  assert.equal(evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', validEntry), 'ALLOW');
  assert.equal(evaluateNotificationCreate(verifiedCtx, 'ntf_1', validNotification), 'ALLOW');

  // 1. Unauthenticated writes
  assert.equal(
    evaluateEntryCreate({ ...verifiedCtx, auth: null }, 'user_1', 'txn_1', validEntry),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate({ ...verifiedCtx, auth: null }, 'ntf_1', validNotification),
    'PERMISSION_DENIED'
  );

  // 2. Unverified email spoof & non-Gmail domain rejection
  const unverifiedCtx: RuleContext = {
    ...verifiedCtx,
    auth: { uid: 'user_1', token: { email: 'owner@gmail.com', email_verified: false } },
  };
  const nonGmailCtx: RuleContext = {
    ...verifiedCtx,
    auth: { uid: 'user_1', token: { email: 'owner@company.com', email_verified: true } },
  };
  assert.equal(evaluateEntryCreate(unverifiedCtx, 'user_1', 'txn_1', validEntry), 'PERMISSION_DENIED');
  assert.equal(
    evaluateNotificationCreate(unverifiedCtx, 'ntf_1', validNotification),
    'PERMISSION_DENIED'
  );
  assert.equal(evaluateEntryCreate(nonGmailCtx, 'user_1', 'txn_1', validEntry), 'PERMISSION_DENIED');
  assert.equal(
    evaluateNotificationCreate(nonGmailCtx, 'ntf_1', validNotification),
    'PERMISSION_DENIED'
  );
  assert.match(RULES_TEXT, /isValidGmailAddress\(request\.auth\.token\.email\)/);

  // 3. Cross-tenant write by user_2 on user_1's entries
  assert.equal(
    evaluateEntryCreate(
      {
        ...verifiedCtx,
        auth: { uid: 'user_2', token: { email: 'other@example.com', email_verified: true } },
      },
      'user_1',
      'txn_1',
      validEntry
    ),
    'PERMISSION_DENIED'
  );

  // 4. Identity spoofing in payload ownerId / actorId
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', { ...validEntry, ownerId: 'user_2' }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate(verifiedCtx, 'ntf_1', { ...validNotification, actorId: 'user_2' }),
    'PERMISSION_DENIED'
  );

  // 5. Shadow / ghost field & PII injection
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', { ...validEntry, isAdmin: true }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate(verifiedCtx, 'ntf_1', {
      ...validNotification,
      email: 'leak@example.com',
    }),
    'PERMISSION_DENIED'
  );

  // 6. ID poisoning
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'bad$id with spaces', {
      ...validEntry,
      id: 'bad$id with spaces',
    }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate(verifiedCtx, 'bad..id', { ...validNotification, id: 'bad..id' }),
    'PERMISSION_DENIED'
  );

  // 7. Orphaned write (parent user doc missing)
  assert.equal(
    evaluateEntryCreate({ ...verifiedCtx, existingUserIds: new Set() }, 'user_1', 'txn_1', validEntry),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate(
      { ...verifiedCtx, existingUserIds: new Set() },
      'ntf_1',
      validNotification
    ),
    'PERMISSION_DENIED'
  );

  // 8. Client timestamp forgery
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', { ...validEntry, createdAt: now - 5000 }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate(verifiedCtx, 'ntf_1', { ...validNotification, createdAt: now - 5000 }),
    'PERMISSION_DENIED'
  );

  // 9. Value poisoning: negative debit & oversized summary
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', { ...validEntry, debit: -500 }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate(verifiedCtx, 'ntf_1', {
      ...validNotification,
      summary: 's'.repeat(201),
    }),
    'PERMISSION_DENIED'
  );

  // 10. Value poisoning: remarks exceeding 300 chars
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', { ...validEntry, remarks: 'x'.repeat(301) }),
    'PERMISSION_DENIED'
  );

  // 11. Invalid group / action / audience enum
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', { ...validEntry, type: 'HACKED_GROUP' }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate(verifiedCtx, 'ntf_1', { ...validNotification, action: 'hacked' }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateNotificationCreate(verifiedCtx, 'ntf_1', { ...validNotification, audience: 'public' }),
    'PERMISSION_DENIED'
  );

  // 12. Poisoned customDeltas shadow key
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', {
      ...validEntry,
      customDeltas: { ko: 0, cash: 0, fino: 0, airtel: 0, bank: 0, credit: 0, evilKey: 1 },
    }),
    'PERMISSION_DENIED'
  );

  // 13. Valid vs poisoned lastModifiedByDeviceId
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', {
      ...validEntry,
      lastModifiedByDeviceId: 'dev_remote_123',
    }),
    'ALLOW'
  );
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', {
      ...validEntry,
      lastModifiedByDeviceId: 'invalid$device id!',
    }),
    'PERMISSION_DENIED'
  );
  assert.equal(
    evaluateEntryCreate(verifiedCtx, 'user_1', 'txn_1', {
      ...validEntry,
      lastModifiedByDeviceId: 'd'.repeat(65),
    }),
    'PERMISSION_DENIED'
  );
  assert.match(RULES_TEXT, /isValidDeviceId\(data\.lastModifiedByDeviceId\)/);
});

const GMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@gmail\.com$/;
const PRIMARY_KO_EMAIL = 'amdsolutionsqdn@gmail.com';

function evaluateSubKoCreate(
  ctx: RuleContext,
  requestId: string,
  data: Record<string, unknown>
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!isVerifiedUser(ctx) || !ctx.auth) return 'PERMISSION_DENIED';
  if (!isValidId(requestId)) return 'PERMISSION_DENIED';
  if (!ctx.existingUserIds.has(ctx.auth.uid)) return 'PERMISSION_DENIED';
  const required = [
    'id',
    'subKoEmail',
    'requestedByUid',
    'requestedByName',
    'primaryOwnerEmail',
    'status',
    'reviewedByUid',
    'createdAt',
    'updatedAt',
  ];
  const keys = Object.keys(data);
  if (keys.length !== required.length || !required.every((k) => keys.includes(k))) {
    return 'PERMISSION_DENIED';
  }
  if (data.id !== requestId || data.requestedByUid !== ctx.auth.uid) return 'PERMISSION_DENIED';
  if (typeof data.subKoEmail !== 'string' || !GMAIL_REGEX.test(data.subKoEmail)) {
    return 'PERMISSION_DENIED';
  }
  if (data.primaryOwnerEmail !== PRIMARY_KO_EMAIL) return 'PERMISSION_DENIED';
  if (data.status !== 'pending' || data.reviewedByUid !== null) return 'PERMISSION_DENIED';
  if (data.createdAt !== ctx.requestTime || data.updatedAt !== ctx.requestTime) {
    return 'PERMISSION_DENIED';
  }
  return 'ALLOW';
}

function evaluateSubKoReview(
  ctx: RuleContext,
  existingDoc: Record<string, unknown>,
  nextStatus: string
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!isVerifiedUser(ctx) || !ctx.auth) return 'PERMISSION_DENIED';
  if (ctx.auth.token.email !== PRIMARY_KO_EMAIL) return 'PERMISSION_DENIED';
  if (existingDoc.status !== 'pending') return 'PERMISSION_DENIED';
  if (nextStatus !== 'approved' && nextStatus !== 'declined') return 'PERMISSION_DENIED';
  return 'ALLOW';
}

test('firestore.rules enforces Primary Owner (KO) Sub-KO approval, Gmail regex, and terminal state lock', () => {
  assert.match(RULES_TEXT, /request\.auth\.token\.email == 'amdsolutionsqdn@gmail\.com'/);
  assert.match(RULES_TEXT, /match \/projectConfig\/\{projectId\}/);
  assert.match(RULES_TEXT, /match \/subKoRequests\/\{requestId\}/);
  assert.match(RULES_TEXT, /existing\(\)\.status == 'pending'/);
  assert.match(RULES_TEXT, /incoming\(\)\.status == 'pending'/);

  const now = 1764095000000;
  const requesterCtx: RuleContext = {
    auth: { uid: 'sub_user', token: { email: 'helper@gmail.com', email_verified: true } },
    requestTime: now,
    existingUserIds: new Set(['sub_user', 'ko_owner']),
  };
  const primaryOwnerCtx: RuleContext = {
    auth: { uid: 'ko_owner', token: { email: PRIMARY_KO_EMAIL, email_verified: true } },
    requestTime: now,
    existingUserIds: new Set(['sub_user', 'ko_owner']),
  };
  const validReq: Record<string, unknown> = {
    id: 'subko_1',
    subKoEmail: 'helper@gmail.com',
    requestedByUid: 'sub_user',
    requestedByName: 'Helper Desk',
    primaryOwnerEmail: PRIMARY_KO_EMAIL,
    status: 'pending',
    reviewedByUid: null,
    createdAt: now,
    updatedAt: now,
  };

  // Valid pending request succeeds
  assert.equal(evaluateSubKoCreate(requesterCtx, 'subko_1', validReq), 'ALLOW');
  // Non-Gmail rejected
  assert.equal(
    evaluateSubKoCreate(requesterCtx, 'subko_1', { ...validReq, subKoEmail: 'helper@yahoo.com' }),
    'PERMISSION_DENIED'
  );
  // State shortcutting (creating already approved) rejected
  assert.equal(
    evaluateSubKoCreate(requesterCtx, 'subko_1', { ...validReq, status: 'approved' }),
    'PERMISSION_DENIED'
  );
  // Primary Owner hijacking rejected
  assert.equal(
    evaluateSubKoCreate(requesterCtx, 'subko_1', {
      ...validReq,
      primaryOwnerEmail: 'attacker@gmail.com',
    }),
    'PERMISSION_DENIED'
  );
  // Non-KO self-approval rejected
  assert.equal(evaluateSubKoReview(requesterCtx, validReq, 'approved'), 'PERMISSION_DENIED');
  // Verified Primary Owner KO approval succeeds
  assert.equal(evaluateSubKoReview(primaryOwnerCtx, validReq, 'approved'), 'ALLOW');
  // Terminal state locking: already-approved request cannot be changed
  assert.equal(
    evaluateSubKoReview(primaryOwnerCtx, { ...validReq, status: 'approved' }, 'declined'),
    'PERMISSION_DENIED'
  );
});
