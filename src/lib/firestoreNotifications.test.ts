import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countUnreadNotifications,
  formatRelativeTime,
  isNotificationUnread,
  NOTIFICATION_LIMITS,
  sanitizeActorName,
  sanitizeNotificationPayload,
  type ActivityNotificationItem,
} from './firestoreNotifications';

test('sanitizeActorName avoids leaking raw email addresses and caps length', () => {
  assert.equal(sanitizeActorName('Amina Store', 'amina@example.com'), 'Amina Store');
  assert.equal(sanitizeActorName('', 'shopkeeper@example.com'), 'shopkeeper');
  assert.equal(sanitizeActorName('owner@example.com', 'owner@example.com'), 'owner');
  assert.equal(sanitizeActorName(null, null), 'Team Member');
  const longName = 'A'.repeat(120);
  assert.equal(sanitizeActorName(longName, null).length, NOTIFICATION_LIMITS.MAX_ACTOR_NAME_LEN);
});

test('sanitizeNotificationPayload enforces blueprint limits and strips unsafe IDs', () => {
  const payload = sanitizeNotificationPayload({
    id: 'bad$id with spaces',
    actorId: 'uid_1',
    actorName: '  Counter Desk  ',
    deviceId: 'dev!@#123',
    action: 'entry_added',
    summary: 'x'.repeat(250),
    targetDate: 'invalid-date',
  });

  assert.match(payload.id, NOTIFICATION_LIMITS.ID_PATTERN);
  assert.match(payload.deviceId, NOTIFICATION_LIMITS.ID_PATTERN);
  assert.equal(payload.audience, 'all_logged_in');
  assert.equal(payload.summary.length, NOTIFICATION_LIMITS.MAX_SUMMARY_LEN);
  assert.match(payload.targetDate, NOTIFICATION_LIMITS.DATE_PATTERN);
});

test('countUnreadNotifications counts only remote notifications newer than lastReadAtMs', () => {
  const items: ActivityNotificationItem[] = [
    {
      id: 'n1',
      actorId: 'u1',
      actorName: 'Device A',
      deviceId: 'dev_local',
      audience: 'all_logged_in',
      action: 'entry_added',
      summary: 'Local change',
      targetDate: '2026-11-25',
      createdAtMs: 5000,
    },
    {
      id: 'n2',
      actorId: 'u1',
      actorName: 'Device B',
      deviceId: 'dev_remote_1',
      audience: 'all_logged_in',
      action: 'entry_updated',
      summary: 'Remote change after cursor',
      targetDate: '2026-11-25',
      createdAtMs: 4000,
    },
    {
      id: 'n3',
      actorId: 'u2',
      actorName: 'Partner Account',
      deviceId: 'dev_remote_2',
      audience: 'all_logged_in',
      action: 'opening_saved',
      summary: 'Another account change',
      targetDate: '2026-11-25',
      createdAtMs: 3500,
    },
    {
      id: 'n4',
      actorId: 'u2',
      actorName: 'Partner Account',
      deviceId: 'dev_remote_2',
      audience: 'all_logged_in',
      action: 'entry_deleted',
      summary: 'Older already-read change',
      targetDate: '2026-11-25',
      createdAtMs: 2000,
    },
  ];

  assert.equal(countUnreadNotifications(items, 3000, 'dev_local'), 2);
  assert.equal(isNotificationUnread(items[0], 3000, 'dev_local'), false);
  assert.equal(isNotificationUnread(items[1], 3000, 'dev_local'), true);
  assert.equal(isNotificationUnread(items[3], 3000, 'dev_local'), false);
});

test('formatRelativeTime formats seconds, minutes, hours, and days concisely', () => {
  const now = 1_764_100_000_000;
  assert.equal(formatRelativeTime(now - 10_000, now), 'Just now');
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m ago');
  assert.equal(formatRelativeTime(now - 3 * 3600_000, now), '3h ago');
  assert.equal(formatRelativeTime(now - 2 * 86400_000, now), '2d ago');
});
