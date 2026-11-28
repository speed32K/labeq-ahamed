import test from 'node:test';
import assert from 'node:assert/strict';
import { planAuthorizedPurgeTargets } from './databasePurge';

test('planAuthorizedPurgeTargets filters strictly to rules-authorized documents for standard users', () => {
  const plan = planAuthorizedPurgeTargets({
    uid: 'user_1',
    email: 'staff.member@gmail.com',
    cloudEntries: [
      { id: 'entry_a', ownerId: 'user_1' },
      { id: 'entry_other', ownerId: 'user_2' },
    ],
    cloudOverrides: [
      { id: '2026-11-27', ownerId: 'user_1' },
      { id: '2026-11-26', ownerId: 'user_2' },
    ],
    cloudNotifications: [
      { id: 'ntf_own', actorId: 'user_1' },
      { id: 'ntf_other', actorId: 'user_2' },
    ],
    cloudSubKoRequests: [
      { id: 'subko_own_pending', requestedByUid: 'user_1', status: 'pending' },
      { id: 'subko_own_approved', requestedByUid: 'user_1', status: 'approved' },
      { id: 'subko_other_pending', requestedByUid: 'user_2', status: 'pending' },
    ],
    localState: {
      entriesByDate: {
        '2026-11-27': [
          {
            id: 'entry_a',
            date: '2026-11-27',
            type: 'SBI CSP',
            serviceType: 'AEPS WITHDRAWAL',
            remarks: '',
            paymentMode: 'Cash',
            debit: 500,
            credit: 0,
            customDeltas: null,
          },
          {
            id: 'entry_local_only',
            date: '2026-11-27',
            type: 'SHOP',
            serviceType: 'PHOTOCOPY',
            remarks: '',
            paymentMode: 'Cash',
            debit: 0,
            credit: 50,
            customDeltas: null,
          },
        ],
      },
      openingOverrides: {
        '2026-11-27': { ko: 1000, cash: 500, fino: 0, airtel: 0, bank: 0, credit: 0 },
        '2026-11-28': { ko: 2000, cash: 500, fino: 0, airtel: 0, bank: 0, credit: 0 },
      },
    },
  });

  assert.deepEqual(plan.entryIds, ['entry_a', 'entry_local_only']);
  assert.deepEqual(plan.overrideDates, ['2026-11-27', '2026-11-28']);
  assert.deepEqual(plan.notificationIds, ['ntf_own']);
  assert.deepEqual(plan.subKoRequestIds, ['subko_own_pending']);
  assert.equal(plan.totalCount, 6);
});

test('planAuthorizedPurgeTargets lets Primary Owner KO delete all Sub-KO requests regardless of status', () => {
  const plan = planAuthorizedPurgeTargets({
    uid: 'ko_uid',
    email: 'amdsolutionsqdn@gmail.com',
    cloudEntries: [],
    cloudOverrides: [],
    cloudNotifications: [],
    cloudSubKoRequests: [
      { id: 'subko_1', requestedByUid: 'user_2', status: 'pending' },
      { id: 'subko_2', requestedByUid: 'user_3', status: 'approved' },
      { id: 'subko_3', requestedByUid: 'user_4', status: 'declined' },
    ],
  });

  assert.deepEqual(plan.subKoRequestIds, ['subko_1', 'subko_2', 'subko_3']);
  assert.equal(plan.totalCount, 3);
});
