export type AutoLockDelayMs = 0 | 30000 | 60000 | 300000;

export const AUTO_LOCK_DELAY_OPTIONS: Array<{ value: AutoLockDelayMs; label: string }> = [
  { value: 0, label: 'Immediately' },
  { value: 30000, label: 'After 30 seconds' },
  { value: 60000, label: 'After 1 minute' },
  { value: 300000, label: 'After 5 minutes' },
];

export interface AppLockSettings {
  enabled: boolean;
  biometricEnrolled: boolean;
  credentialId: string | null;
  passcodeHash: string | null;
  passcodeSalt: string | null;
  autoLockDelayMs: AutoLockDelayMs;
  enrolledAtMs: number | null;
}

export const APP_LOCK_STORAGE_KEY = 'shop_daily_logs_app_lock_v1';

const VALID_DELAYS = new Set<number>([0, 30000, 60000, 300000]);

export function createDefaultAppLockSettings(): AppLockSettings {
  return {
    enabled: false,
    biometricEnrolled: false,
    credentialId: null,
    passcodeHash: null,
    passcodeSalt: null,
    autoLockDelayMs: 0,
    enrolledAtMs: null,
  };
}

export function isAppLockConfigured(settings: AppLockSettings): boolean {
  return Boolean(
    (settings.biometricEnrolled && settings.credentialId) ||
      (settings.passcodeHash && settings.passcodeSalt)
  );
}

export function parseAppLockSettings(raw: string | null): AppLockSettings {
  const fallback = createDefaultAppLockSettings();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<AppLockSettings>;
    if (!parsed || typeof parsed !== 'object') return fallback;

    const credentialId =
      typeof parsed.credentialId === 'string' && parsed.credentialId.length > 0
        ? parsed.credentialId
        : null;
    const biometricEnrolled = Boolean(parsed.biometricEnrolled && credentialId);
    const passcodeHash =
      typeof parsed.passcodeHash === 'string' && parsed.passcodeHash.length > 0
        ? parsed.passcodeHash
        : null;
    const passcodeSalt =
      typeof parsed.passcodeSalt === 'string' && parsed.passcodeSalt.length > 0
        ? parsed.passcodeSalt
        : null;
    const hasPasscode = Boolean(passcodeHash && passcodeSalt);
    const autoLockDelayMs: AutoLockDelayMs = VALID_DELAYS.has(Number(parsed.autoLockDelayMs))
      ? (Number(parsed.autoLockDelayMs) as AutoLockDelayMs)
      : 0;
    const enrolledAtMs =
      typeof parsed.enrolledAtMs === 'number' && Number.isFinite(parsed.enrolledAtMs)
        ? parsed.enrolledAtMs
        : null;

    const configured = biometricEnrolled || hasPasscode;
    return {
      enabled: Boolean(parsed.enabled && configured),
      biometricEnrolled,
      credentialId,
      passcodeHash: hasPasscode ? passcodeHash : null,
      passcodeSalt: hasPasscode ? passcodeSalt : null,
      autoLockDelayMs,
      enrolledAtMs,
    };
  } catch {
    return fallback;
  }
}

export function shouldLockOnColdStart(settings: AppLockSettings): boolean {
  return settings.enabled && isAppLockConfigured(settings);
}

export function shouldLockAfterBackground(params: {
  settings: AppLockSettings;
  backgroundedAtMs: number | null;
  nowMs: number;
}): boolean {
  const { settings, backgroundedAtMs, nowMs } = params;
  if (!settings.enabled || !isAppLockConfigured(settings)) {
    return false;
  }
  if (backgroundedAtMs === null) {
    return false;
  }
  const elapsed = Math.max(0, nowMs - backgroundedAtMs);
  return elapsed >= settings.autoLockDelayMs;
}

export function validatePasscode(pin: string): { ok: true } | { ok: false; error: string } {
  const trimmed = (pin || '').trim();
  if (!/^\d{4,6}$/.test(trimmed)) {
    return {
      ok: false,
      error: 'Enter a 4 to 6 digit numeric PIN.',
    };
  }
  return { ok: true };
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export function generateRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export async function hashPasscode(pin: string, salt: string): Promise<string> {
  const encoded = new TextEncoder().encode(`${salt}:${pin.trim()}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPasscodeHash(
  pin: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  const computed = await hashPasscode(pin, salt);
  if (computed.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i += 1) {
    diff |= computed.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

export async function checkPlatformBiometricSupport(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    typeof PublicKeyCredential === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.credentials
  ) {
    return false;
  }
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return false;
  } catch {
    return false;
  }
}

function getWebAuthnRpId(): string {
  if (typeof window === 'undefined') return 'localhost';
  return window.location.hostname || 'localhost';
}

export async function enrollPlatformBiometric(params: {
  userId: string;
  userName: string;
  displayName: string;
}): Promise<{ ok: true; credentialId: string } | { ok: false; error: string }> {
  const supported = await checkPlatformBiometricSupport();
  if (!supported) {
    return {
      ok: false,
      error: 'Biometric authentication is not available on this device or browser.',
    };
  }

  try {
    const challenge = generateRandomBytes(32);
    const userIdBytes = new TextEncoder().encode(params.userId.slice(0, 64));
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: challenge.buffer as ArrayBuffer,
        rp: {
          name: 'Shop Daily Log Entries',
          id: getWebAuthnRpId(),
        },
        user: {
          id: userIdBytes.buffer as ArrayBuffer,
          name: params.userName,
          displayName: params.displayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!credential || !credential.rawId) {
      return {
        ok: false,
        error: 'Biometric setup did not complete. Please try again.',
      };
    }

    return {
      ok: true,
      credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError') {
      return {
        ok: false,
        error: 'Biometric verification was canceled or timed out.',
      };
    }
    return {
      ok: false,
      error: 'Could not enroll biometric authentication on this device.',
    };
  }
}

export async function verifyPlatformBiometric(
  credentialId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supported = await checkPlatformBiometricSupport();
  if (!supported) {
    return {
      ok: false,
      error: 'Biometric sensor is unavailable. Use your backup PIN to unlock.',
    };
  }

  try {
    const challenge = generateRandomBytes(32);
    const rawId = fromBase64Url(credentialId);
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge.buffer as ArrayBuffer,
        rpId: getWebAuthnRpId(),
        allowCredentials: [
          {
            id: rawId.buffer as ArrayBuffer,
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    if (!assertion) {
      return {
        ok: false,
        error: 'Biometric authentication could not be verified.',
      };
    }
    return { ok: true };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError') {
      return {
        ok: false,
        error: 'Biometric unlock was canceled. Try again or use your backup PIN.',
      };
    }
    return {
      ok: false,
      error: 'Biometric authentication failed. Try again or use your backup PIN.',
    };
  }
}
