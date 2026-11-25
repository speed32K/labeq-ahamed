export const PRIMARY_OWNER_KO_EMAIL = 'amdsolutionsqdn@gmail.com' as const;

export type AnimationPreset = 'none' | 'pulse_orbit' | 'ledger_flow' | 'emerald_wave';
export type SubKoStatus = 'pending' | 'approved' | 'declined';

export interface ProjectOwnershipConfig {
  id: 'default';
  primaryOwnerEmail: string;
  animationPreset: AnimationPreset;
  animationTitle: string;
  updatedByUid: string;
  updatedAtMs: number;
}

export interface SubKoRequestRecord {
  id: string;
  subKoEmail: string;
  requestedByUid: string;
  requestedByName: string;
  primaryOwnerEmail: string;
  status: SubKoStatus;
  reviewedByUid: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export const OWNERSHIP_LIMITS = {
  GMAIL_REGEX: /^[a-zA-Z0-9._%+\-]+@gmail\.com$/,
  MAX_EMAIL_LEN: 254,
  MAX_ANIMATION_TITLE_LEN: 80,
  MAX_REQUESTER_NAME_LEN: 80,
} as const;

export const ANIMATION_PRESETS: Array<{
  id: AnimationPreset;
  label: string;
  description: string;
}> = [
  {
    id: 'pulse_orbit',
    label: 'Pulse Orbit',
    description: 'Subtle orbital rings around your shop crest.',
  },
  {
    id: 'ledger_flow',
    label: 'Ledger Flow',
    description: 'Balanced animated debit/credit signal bars.',
  },
  {
    id: 'emerald_wave',
    label: 'Emerald Wave',
    description: 'Calm horizontal liquidity wave ribbon.',
  },
  {
    id: 'none',
    label: 'No Animation',
    description: 'Static minimal project header.',
  },
];

export function normalizeGmailAddress(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

export function isValidGmailAddress(raw: string): boolean {
  const normalized = normalizeGmailAddress(raw);
  return (
    normalized.length >= 11 &&
    normalized.length <= OWNERSHIP_LIMITS.MAX_EMAIL_LEN &&
    OWNERSHIP_LIMITS.GMAIL_REGEX.test(normalized)
  );
}

const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLoginEmailInput(
  rawEmail: string
): { ok: true; normalizedEmail: string } | { ok: false; error: string } {
  const normalized = normalizeGmailAddress(rawEmail);
  if (!normalized) {
    return {
      ok: false,
      error: 'Please enter your email address to log in.',
    };
  }
  if (normalized.length > OWNERSHIP_LIMITS.MAX_EMAIL_LEN || !BASIC_EMAIL_REGEX.test(normalized)) {
    return {
      ok: false,
      error: 'Please enter a valid email address.',
    };
  }
  if (!isValidGmailAddress(normalized)) {
    return {
      ok: false,
      error: 'Only authorized Google Gmail accounts can log in to this workspace.',
    };
  }
  return {
    ok: true,
    normalizedEmail: normalized,
  };
}

export function isPrimaryOwnerEmail(email?: string | null): boolean {
  return normalizeGmailAddress(email || '') === PRIMARY_OWNER_KO_EMAIL;
}

export function canApproveSubKoRequest(
  reviewerEmail: string | null | undefined,
  request: Pick<SubKoRequestRecord, 'status'>
): boolean {
  return isPrimaryOwnerEmail(reviewerEmail) && request.status === 'pending';
}

export function validateSubKoCandidate(
  rawEmail: string,
  existingRequests: SubKoRequestRecord[]
): { ok: true; normalizedEmail: string } | { ok: false; error: string } {
  const normalized = normalizeGmailAddress(rawEmail);
  if (!isValidGmailAddress(normalized)) {
    return {
      ok: false,
      error: 'Enter a valid Gmail address ending in @gmail.com.',
    };
  }
  if (normalized === PRIMARY_OWNER_KO_EMAIL) {
    return {
      ok: false,
      error: `${PRIMARY_OWNER_KO_EMAIL} is already designated as the Project Primary Owner (KO).`,
    };
  }
  const existingActive = existingRequests.find(
    (req) =>
      normalizeGmailAddress(req.subKoEmail) === normalized &&
      (req.status === 'pending' || req.status === 'approved')
  );
  if (existingActive) {
    return {
      ok: false,
      error:
        existingActive.status === 'approved'
          ? `${normalized} is already a confirmed Sub-KO.`
          : `A verification request for ${normalized} is already pending KO approval.`,
    };
  }
  return { ok: true, normalizedEmail: normalized };
}

export function createDefaultProjectConfig(): ProjectOwnershipConfig {
  return {
    id: 'default',
    primaryOwnerEmail: PRIMARY_OWNER_KO_EMAIL,
    animationPreset: 'pulse_orbit',
    animationTitle: 'Shop Daily Log Workspace',
    updatedByUid: 'local',
    updatedAtMs: Date.now(),
  };
}

export type LoginAuthorizationRole = 'primary_owner_ko' | 'approved_sub_ko' | 'registered_gmail';

export type LoginDenialReason =
  | 'unverified_email'
  | 'non_gmail'
  | 'pending_sub_ko'
  | 'unregistered_gmail';

export interface LoginEligibilityInput {
  email: string | null | undefined;
  emailVerified: boolean;
  hasRegisteredProfile?: boolean;
  hasApprovedSubKo?: boolean;
  hasPendingSubKo?: boolean;
}

export type LoginEligibilityResult =
  | {
      allowed: true;
      role: LoginAuthorizationRole;
      normalizedEmail: string;
    }
  | {
      allowed: false;
      reason: LoginDenialReason;
      normalizedEmail: string;
      message: string;
    };

export function evaluateLoginEligibility(input: LoginEligibilityInput): LoginEligibilityResult {
  const normalizedEmail = normalizeGmailAddress(input.email || '');

  if (!input.emailVerified) {
    return {
      allowed: false,
      reason: 'unverified_email',
      normalizedEmail,
      message: 'Your Google account email must be verified before signing in.',
    };
  }

  if (!isValidGmailAddress(normalizedEmail)) {
    return {
      allowed: false,
      reason: 'non_gmail',
      normalizedEmail,
      message: `Only Gmail accounts (@gmail.com) are allowed. Sign in with ${PRIMARY_OWNER_KO_EMAIL} or a registered Gmail account.`,
    };
  }

  if (isPrimaryOwnerEmail(normalizedEmail)) {
    return {
      allowed: true,
      role: 'primary_owner_ko',
      normalizedEmail,
    };
  }

  if (input.hasApprovedSubKo) {
    return {
      allowed: true,
      role: 'approved_sub_ko',
      normalizedEmail,
    };
  }

  if (input.hasRegisteredProfile) {
    return {
      allowed: true,
      role: 'registered_gmail',
      normalizedEmail,
    };
  }

  if (input.hasPendingSubKo) {
    return {
      allowed: false,
      reason: 'pending_sub_ko',
      normalizedEmail,
      message: `${normalizedEmail} has a pending Sub-KO verification request awaiting approval from ${PRIMARY_OWNER_KO_EMAIL}.`,
    };
  }

  return {
    allowed: false,
    reason: 'unregistered_gmail',
    normalizedEmail,
    message: `${normalizedEmail} is not a registered Gmail account. You may only log in using ${PRIMARY_OWNER_KO_EMAIL} or a registered Gmail account.`,
  };
}

