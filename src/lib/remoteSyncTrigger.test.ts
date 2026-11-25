import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState, LogEntry } from '../types/ledger';
import {
  applyRemoteEntryToAppState,
  detectRemoteEntrySyncEvents,
  formatRemoteSyncBannerCopy,
  haveLedgerEntryContentFieldsChanged,
} from './remoteSyncTrigger';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'txn_1',
    date: '2026-11-25',
    type: 'SBI CSP',
    serviceType: 'AEPS WITHDRAWAL',
    remarks: 'Shafeek',
    paymentMode: 'Cash',
    debit: 1000,
    credit: 0,
    customDeltas: null,
    ...overrides,
  };
}

test('detectRemoteEntrySyncEvents ignores initial load, pending writes, and same-device echoes', () => {
  const entry = makeEntry();
  const prevMap = new Map<string, LogEntry>();

  // 1. Initial load must never fire remote alerts
  assert.deepEqual(
    detectRemoteEntrySyncEvents({
      initialSnapshotHandled: false,
      snapshotHasPendingWrites: false,
      currentDeviceId: 'dev_local',
      previousEntriesById: prevMap,
      changes: [
        {
          changeType: 'added',
          hasPendingWrites: false,
          entry,
          lastModifiedByDeviceId: 'dev_remote',
          updatedAtMs: 1000,
        },
      ],
    }),
    []
  );

  // 2. Local optimistic pending writes are skipped
  assert.deepEqual(
    detectRemoteEntrySyncEvents({
      initialSnapshotHandled: true,
      snapshotHasPendingWrites: true,
      currentDeviceId: 'dev_local',
      previousEntriesById: prevMap,
      changes: [
        {
          changeType: 'added',
          hasPendingWrites: true,
          entry,
          lastModifiedByDeviceId: 'dev_local',
          updatedAtMs: 1000,
        },
      ],
    }),
    []
  );

  // 3. Same-device serverTimestamp settlement echo (hasPendingWrites: false) is skipped
  assert.deepEqual(
    detectRemoteEntrySyncEvents({
      initialSnapshotHandled: true,
      snapshotHasPendingWrites: false,
      currentDeviceId: 'dev_local',
      previousEntriesById: prevMap,
      changes: [
        {
          changeType: 'added',
          hasPendingWrites: false,
          entry,
          lastModifiedByDeviceId: 'dev_local',
          updatedAtMs: 2000,
        },
      ],
    }),
    []
  );
});

test('detectRemoteEntrySyncEvents detects genuine remote additions and updates while ignoring order-only changes', () => {
  const existing = makeEntry({ id: 'txn_existing', debit: 500, remarks: 'Initial' });
  const prevMap = new Map<string, LogEntry>([[existing.id, existing]]);

  // Pure orderIndex reorder (content identical) -> no event
  assert.equal(haveLedgerEntryContentFieldsChanged(existing, makeEntry({ id: 'txn_existing', debit: 500, remarks: 'Initial' })), false);
  assert.deepEqual(
    detectRemoteEntrySyncEvents({
      initialSnapshotHandled: true,
      snapshotHasPendingWrites: false,
      currentDeviceId: 'dev_local',
      previousEntriesById: prevMap,
      changes: [
        {
          changeType: 'modified',
          hasPendingWrites: false,
          entry: makeEntry({ id: 'txn_existing', debit: 500, remarks: 'Initial' }),
          lastModifiedByDeviceId: 'dev_remote',
          updatedAtMs: 3000,
        },
      ],
    }),
    []
  );

  // Remote addition + remote update in same snapshot
  const addedEntry = makeEntry({
    id: 'txn_remote_new',
    type: 'AIRTEL CSP',
    serviceType: 'CASH DEPOSIT',
    credit: 2500,
    debit: 0,
    remarks: 'Counter 2',
  });
  const updatedEntry = makeEntry({
    id: 'txn_existing',
    debit: 750,
    remarks: 'Corrected on phone',
  });

  const events = detectRemoteEntrySyncEvents({
    initialSnapshotHandled: true,
    snapshotHasPendingWrites: false,
    currentDeviceId: 'dev_local',
    previousEntriesById: prevMap,
    changes: [
      {
        changeType: 'added',
        hasPendingWrites: false,
        entry: addedEntry,
        lastModifiedByDeviceId: 'dev_remote_phone',
        updatedAtMs: 4000,
      },
      {
        changeType: 'modified',
        hasPendingWrites: false,
        entry: updatedEntry,
        lastModifiedByDeviceId: 'dev_remote_phone',
        updatedAtMs: 4100,
      },
    ],
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'added');
  assert.equal(events[0].entryId, 'txn_remote_new');
  assert.equal(events[0].headline, 'Remote device added an entry');
  assert.match(events[0].detail, /AIRTEL CSP · CASH DEPOSIT/);
  assert.match(events[0].detail, /Cr 2,500/);

  assert.equal(events[1].kind, 'updated');
  assert.equal(events[1].entryId, 'txn_existing');
  assert.equal(events[1].headline, 'Remote device updated an entry');
  assert.match(events[1].detail, /Dr 750/);
});

test('applyRemoteEntryToAppState is idempotent on duplicate adds and moves entries cleanly across dates', () => {
  const initialEntry = makeEntry({ id: 'txn_a', date: '2026-11-25', debit: 400 });
  const state: AppState = {
    initialized: true,
    entriesByDate: {
      '2026-11-25': [initialEntry],
    },
    openingOverrides: {},
  };

  // Duplicate add must not create two copies
  const afterDupAdd = applyRemoteEntryToAppState(state, initialEntry, 'added');
  assert.equal(afterDupAdd.entriesByDate['2026-11-25'].length, 1);

  // Genuine remote add appends cleanly
  const secondEntry = makeEntry({ id: 'txn_b', date: '2026-11-25', credit: 900, debit: 0 });
  const afterAdd = applyRemoteEntryToAppState(afterDupAdd, secondEntry, 'added');
  assert.equal(afterAdd.entriesByDate['2026-11-25'].length, 2);

  // Remote update moving entry to another date cleans up source date
  const movedEntry = { ...secondEntry, date: '2026-11-26', credit: 1200 };
  const afterMove = applyRemoteEntryToAppState(afterAdd, movedEntry, 'updated');
  assert.equal(afterMove.entriesByDate['2026-11-25'].length, 1);
  assert.equal(afterMove.entriesByDate['2026-11-26'].length, 1);
  assert.equal(afterMove.entriesByDate['2026-11-26'][0].credit, 1200);
});

test('formatRemoteSyncBannerCopy flags editing conflict when remote device updates the currently edited entry', () => {
  const events = detectRemoteEntrySyncEvents({
    initialSnapshotHandled: true,
    snapshotHasPendingWrites: false,
    currentDeviceId: 'dev_local',
    previousEntriesById: new Map([['txn_1', makeEntry({ debit: 1000 })]]),
    changes: [
      {
        changeType: 'modified',
        hasPendingWrites: false,
        entry: makeEntry({ debit: 1800, remarks: 'Edited remotely' }),
        lastModifiedByDeviceId: 'dev_remote',
        updatedAtMs: 5000,
      },
    ],
  });

  const withConflict = formatRemoteSyncBannerCopy(events, 'txn_1');
  assert.ok(withConflict);
  assert.equal(withConflict.editingConflict, true);
  assert.equal(withConflict.title, 'Remote device updated an entry');

  const withoutConflict = formatRemoteSyncBannerCopy(events, 'txn_other');
  assert.ok(withoutConflict);
  assert.equal(withoutConflict.editingConflict, false);
});
