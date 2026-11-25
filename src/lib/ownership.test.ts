import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canApproveSubKoRequest,
  evaluateLoginEligibility,
  isPrimaryOwnerEmail,
  isValidGmailAddress,
  PRIMARY_OWNER_KO_EMAIL,
  validateLoginEmailInput,
  validateSubKoCandidate,
  type SubKoRequestRecord,
} from './ownership';

test('isValidGmailAddress strictly validates Gmail accounts', () => {
  assert.equal(isValidGmailAddress('subko.desk@gmail.com'), true);
  assert.equal(isValidGmailAddress('  SUBKO+1@GMAIL.COM  '), true);
  assert.equal(isValidGmailAddress('user@yahoo.com'), false);
  assert.equal(isValidGmailAddress('user@gmail.co'), false);
  assert.equal(isValidGmailAddress('not-an-email'), false);
  assert.equal(isValidGmailAddress('@gmail.com'), false);
});

test('validateLoginEmailInput validates empty, malformed, non-Gmail, and valid Gmail inputs', () => {
  const empty = validateLoginEmailInput('   ');
  assert.equal(empty.ok, false);

  const malformed = validateLoginEmailInput('not-an-email');
  assert.equal(malformed.ok, false);

  const nonGmail = validateLoginEmailInput('owner@company.com');
  assert.equal(nonGmail.ok, false);

  const valid = validateLoginEmailInput('  AMDSolutionsQDN@Gmail.com  ');
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.normalizedEmail, 'amdsolutionsqdn@gmail.com');
  }
});

test('isPrimaryOwnerEmail matches amdsolutionsqdn@gmail.com case-insensitively', () => {
  assert.equal(isPrimaryOwnerEmail(PRIMARY_OWNER_KO_EMAIL), true);
  assert.equal(isPrimaryOwnerEmail('AMDSOLUTIONSQDN@GMAIL.COM'), true);
  assert.equal(isPrimaryOwnerEmail('other@gmail.com'), false);
  assert.equal(isPrimaryOwnerEmail(null), false);
});

test('validateSubKoCandidate blocks non-Gmail, Primary Owner KO, and active duplicates', () => {
  const existing: SubKoRequestRecord[] = [
    {
      id: 'req_1',
      subKoEmail: 'pending.user@gmail.com',
      requestedByUid: 'u1',
      requestedByName: 'Desk 1',
      primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
      status: 'pending',
      reviewedByUid: null,
      createdAtMs: 1000,
      updatedAtMs: 1000,
    },
    {
      id: 'req_2',
      subKoEmail: 'confirmed.user@gmail.com',
      requestedByUid: 'u2',
      requestedByName: 'Desk 2',
      primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
      status: 'approved',
      reviewedByUid: 'ko_uid',
      createdAtMs: 1000,
      updatedAtMs: 2000,
    },
  ];

  assert.equal(validateSubKoCandidate('person@outlook.com', existing).ok, false);
  assert.equal(validateSubKoCandidate(PRIMARY_OWNER_KO_EMAIL, existing).ok, false);
  assert.equal(validateSubKoCandidate('pending.user@gmail.com', existing).ok, false);
  assert.equal(validateSubKoCandidate('confirmed.user@gmail.com', existing).ok, false);

  const valid = validateSubKoCandidate('  New.SubKO@gmail.com ', existing);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.normalizedEmail, 'new.subko@gmail.com');
  }
});

test('canApproveSubKoRequest permits only Primary Owner (KO) on pending requests', () => {
  assert.equal(canApproveSubKoRequest(PRIMARY_OWNER_KO_EMAIL, { status: 'pending' }), true);
  assert.equal(canApproveSubKoRequest(PRIMARY_OWNER_KO_EMAIL, { status: 'approved' }), false);
  assert.equal(canApproveSubKoRequest(PRIMARY_OWNER_KO_EMAIL, { status: 'declined' }), false);
  assert.equal(canApproveSubKoRequest('someoneelse@gmail.com', { status: 'pending' }), false);
  assert.equal(canApproveSubKoRequest(null, { status: 'pending' }), false);
});

test('evaluateLoginEligibility allows only Primary Owner KO or registered/approved Gmail accounts', () => {
  // Primary Owner KO is always permitted when verified
  const ko = evaluateLoginEligibility({
    email: 'AMDSOLUTIONSQDN@GMAIL.COM',
    emailVerified: true,
  });
  assert.equal(ko.allowed, true);
  if (ko.allowed) assert.equal(ko.role, 'primary_owner_ko');

  // Approved Sub-KO Gmail is permitted
  const subKo = evaluateLoginEligibility({
    email: 'subko.operator@gmail.com',
    emailVerified: true,
    hasApprovedSubKo: true,
  });
  assert.equal(subKo.allowed, true);
  if (subKo.allowed) assert.equal(subKo.role, 'approved_sub_ko');

  // Existing registered Gmail profile is permitted
  const registered = evaluateLoginEligibility({
    email: 'registered.staff@gmail.com',
    emailVerified: true,
    hasRegisteredProfile: true,
  });
  assert.equal(registered.allowed, true);
  if (registered.allowed) assert.equal(registered.role, 'registered_gmail');

  // Pending Sub-KO Gmail (not yet approved, no profile) is denied with pending reason
  const pending = evaluateLoginEligibility({
    email: 'waiting.subko@gmail.com',
    emailVerified: true,
    hasPendingSubKo: true,
  });
  assert.equal(pending.allowed, false);
  if (!pending.allowed) assert.equal(pending.reason, 'pending_sub_ko');

  // Unregistered Gmail is denied
  const unregistered = evaluateLoginEligibility({
    email: 'random.stranger@gmail.com',
    emailVerified: true,
  });
  assert.equal(unregistered.allowed, false);
  if (!unregistered.allowed) assert.equal(unregistered.reason, 'unregistered_gmail');

  // Non-Gmail Google Workspace account is denied
  const nonGmail = evaluateLoginEligibility({
    email: 'staff@company.com',
    emailVerified: true,
    hasRegisteredProfile: true,
  });
  assert.equal(nonGmail.allowed, false);
  if (!nonGmail.allowed) assert.equal(nonGmail.reason, 'non_gmail');

  // Unverified email is denied even for Primary Owner email
  const unverified = evaluateLoginEligibility({
    email: PRIMARY_OWNER_KO_EMAIL,
    emailVerified: false,
  });
  assert.equal(unverified.allowed, false);
  if (!unverified.allowed) assert.equal(unverified.reason, 'unverified_email');
});

