import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultAppLockSettings,
  fromBase64Url,
  hashPasscode,
  isAppLockConfigured,
  parseAppLockSettings,
  shouldLockAfterBackground,
  shouldLockOnColdStart,
  toBase64Url,
  validatePasscode,
  verifyPasscodeHash,
} from './biometricLock';

test('parseAppLockSettings safely handles null, malformed JSON, and unconfigured enabled flags', () => {
  assert.deepEqual(parseAppLockSettings(null), createDefaultAppLockSettings());
  assert.deepEqual(parseAppLockSettings('{bad json'), createDefaultAppLockSettings());

  // Cannot be enabled if neither biometric nor passcode is enrolled
  const orphanEnabled = parseAppLockSettings(JSON.stringify({ enabled: true }));
  assert.equal(orphanEnabled.enabled, false);
  assert.equal(isAppLockConfigured(orphanEnabled), false);

  // Valid biometric config stays enabled
  const validBiometric = parseAppLockSettings(
    JSON.stringify({
      enabled: true,
      biometricEnrolled: true,
      credentialId: 'cred_abc123',
      autoLockDelayMs: 60000,
      enrolledAtMs: 1700000000000,
    })
  );
  assert.equal(validBiometric.enabled, true);
  assert.equal(validBiometric.biometricEnrolled, true);
  assert.equal(validBiometric.autoLockDelayMs, 60000);
});

test('shouldLockOnColdStart and shouldLockAfterBackground enforce app close and background policies', () => {
  const configured = parseAppLockSettings(
    JSON.stringify({
      enabled: true,
      biometricEnrolled: true,
      credentialId: 'cred_1',
      autoLockDelayMs: 30000,
    })
  );

  assert.equal(shouldLockOnColdStart(configured), true);
  assert.equal(
    shouldLockAfterBackground({
      settings: configured,
      backgroundedAtMs: 10000,
      nowMs: 25000,
    }),
    false
  );
  assert.equal(
    shouldLockAfterBackground({
      settings: configured,
      backgroundedAtMs: 10000,
      nowMs: 40000,
    }),
    true
  );

  const immediate = { ...configured, autoLockDelayMs: 0 as const };
  assert.equal(
    shouldLockAfterBackground({
      settings: immediate,
      backgroundedAtMs: 5000,
      nowMs: 5000,
    }),
    true
  );

  const disabled = { ...configured, enabled: false };
  assert.equal(shouldLockOnColdStart(disabled), false);
  assert.equal(
    shouldLockAfterBackground({
      settings: disabled,
      backgroundedAtMs: 0,
      nowMs: 999999,
    }),
    false
  );
});

test('validatePasscode, hashPasscode, and verifyPasscodeHash verify 4-6 digit PINs securely', async () => {
  assert.equal(validatePasscode('123').ok, false);
  assert.equal(validatePasscode('1234567').ok, false);
  assert.equal(validatePasscode('12ab').ok, false);
  assert.equal(validatePasscode('2580').ok, true);
  assert.equal(validatePasscode('258099').ok, true);

  const hash = await hashPasscode('2580', 'salt_xyz');
  assert.equal(await verifyPasscodeHash('2580', 'salt_xyz', hash), true);
  assert.equal(await verifyPasscodeHash('0000', 'salt_xyz', hash), false);
  assert.equal(await verifyPasscodeHash('2580', 'other_salt', hash), false);
});

test('toBase64Url and fromBase64Url round-trip credential bytes accurately', () => {
  const input = new Uint8Array([0, 15, 42, 128, 254, 255]);
  const encoded = toBase64Url(input);
  assert.equal(encoded.includes('+'), false);
  assert.equal(encoded.includes('/'), false);
  assert.equal(encoded.includes('='), false);
  assert.deepEqual(Array.from(fromBase64Url(encoded)), Array.from(input));
});
