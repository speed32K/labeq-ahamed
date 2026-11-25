import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APP_LOCK_STORAGE_KEY,
  checkPlatformBiometricSupport,
  createDefaultAppLockSettings,
  enrollPlatformBiometric,
  generateRandomBytes,
  hashPasscode,
  isAppLockConfigured,
  parseAppLockSettings,
  shouldLockAfterBackground,
  shouldLockOnColdStart,
  toBase64Url,
  validatePasscode,
  verifyPasscodeHash,
  verifyPlatformBiometric,
  type AppLockSettings,
  type AutoLockDelayMs,
} from '../lib/biometricLock';

function loadInitialSettings(): AppLockSettings {
  if (typeof window === 'undefined') return createDefaultAppLockSettings();
  try {
    return parseAppLockSettings(window.localStorage.getItem(APP_LOCK_STORAGE_KEY));
  } catch {
    return createDefaultAppLockSettings();
  }
}

export interface UseAppLockResult {
  settings: AppLockSettings;
  isConfigured: boolean;
  isLocked: boolean;
  biometricSupported: boolean;
  checkingSupport: boolean;
  enrollBiometric: (params: {
    userId: string;
    userName: string;
    displayName: string;
    backupPin?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  setupPasscodeLock: (pin: string) => Promise<{ ok: boolean; error?: string }>;
  setEnabled: (enabled: boolean) => { ok: boolean; error?: string };
  setAutoLockDelay: (delayMs: AutoLockDelayMs) => void;
  lockNow: () => void;
  resetAppLock: () => void;
  unlockWithBiometric: () => Promise<{ ok: boolean; error?: string }>;
  unlockWithPasscode: (pin: string) => Promise<{ ok: boolean; error?: string }>;
}

export function useAppLock(): UseAppLockResult {
  const [settings, setSettings] = useState<AppLockSettings>(() => loadInitialSettings());
  const [isLocked, setIsLocked] = useState<boolean>(() =>
    shouldLockOnColdStart(loadInitialSettings())
  );
  const [biometricSupported, setBiometricSupported] = useState<boolean>(false);
  const [checkingSupport, setCheckingSupport] = useState<boolean>(true);
  const settingsRef = useRef<AppLockSettings>(settings);
  settingsRef.current = settings;
  const backgroundedAtRef = useRef<number | null>(null);

  const persistSettings = useCallback((next: AppLockSettings) => {
    settingsRef.current = next;
    setSettings(next);
    try {
      window.localStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('Could not persist app lock settings:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void checkPlatformBiometricSupport().then((supported) => {
      if (!active) return;
      setBiometricSupported(supported);
      setCheckingSupport(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const current = settingsRef.current;
      if (!current.enabled || !isAppLockConfigured(current)) {
        backgroundedAtRef.current = null;
        return;
      }

      if (document.visibilityState === 'hidden') {
        backgroundedAtRef.current = Date.now();
        if (current.autoLockDelayMs === 0) {
          setIsLocked(true);
        }
      } else if (document.visibilityState === 'visible') {
        if (
          shouldLockAfterBackground({
            settings: current,
            backgroundedAtMs: backgroundedAtRef.current,
            nowMs: Date.now(),
          })
        ) {
          setIsLocked(true);
        }
        backgroundedAtRef.current = null;
      }
    };

    const handlePageHide = () => {
      const current = settingsRef.current;
      if (current.enabled && isAppLockConfigured(current)) {
        backgroundedAtRef.current = Date.now();
        if (current.autoLockDelayMs === 0) {
          setIsLocked(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  const enrollBiometric = useCallback(
    async (params: {
      userId: string;
      userName: string;
      displayName: string;
      backupPin?: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      let nextPasscodeHash = settingsRef.current.passcodeHash;
      let nextPasscodeSalt = settingsRef.current.passcodeSalt;

      if (params.backupPin && params.backupPin.trim().length > 0) {
        const pinCheck = validatePasscode(params.backupPin);
        if (!pinCheck.ok) {
          return { ok: false, error: pinCheck.error };
        }
        const salt = toBase64Url(generateRandomBytes(16));
        nextPasscodeHash = await hashPasscode(params.backupPin, salt);
        nextPasscodeSalt = salt;
      }

      const result = await enrollPlatformBiometric({
        userId: params.userId,
        userName: params.userName,
        displayName: params.displayName,
      });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      persistSettings({
        ...settingsRef.current,
        enabled: true,
        biometricEnrolled: true,
        credentialId: result.credentialId,
        passcodeHash: nextPasscodeHash,
        passcodeSalt: nextPasscodeSalt,
        enrolledAtMs: Date.now(),
      });
      return { ok: true };
    },
    [persistSettings]
  );

  const setupPasscodeLock = useCallback(
    async (pin: string): Promise<{ ok: boolean; error?: string }> => {
      const validation = validatePasscode(pin);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }
      const salt = toBase64Url(generateRandomBytes(16));
      const hash = await hashPasscode(pin, salt);
      persistSettings({
        ...settingsRef.current,
        enabled: true,
        passcodeHash: hash,
        passcodeSalt: salt,
        enrolledAtMs: settingsRef.current.enrolledAtMs ?? Date.now(),
      });
      return { ok: true };
    },
    [persistSettings]
  );

  const setEnabled = useCallback(
    (enabled: boolean): { ok: boolean; error?: string } => {
      if (enabled && !isAppLockConfigured(settingsRef.current)) {
        return {
          ok: false,
          error: 'Set up biometric authentication or a backup PIN first.',
        };
      }
      persistSettings({
        ...settingsRef.current,
        enabled,
      });
      if (!enabled) {
        setIsLocked(false);
        backgroundedAtRef.current = null;
      }
      return { ok: true };
    },
    [persistSettings]
  );

  const setAutoLockDelay = useCallback(
    (delayMs: AutoLockDelayMs) => {
      persistSettings({
        ...settingsRef.current,
        autoLockDelayMs: delayMs,
      });
    },
    [persistSettings]
  );

  const lockNow = useCallback(() => {
    if (isAppLockConfigured(settingsRef.current)) {
      if (!settingsRef.current.enabled) {
        persistSettings({
          ...settingsRef.current,
          enabled: true,
        });
      }
      setIsLocked(true);
    }
  }, [persistSettings]);

  const resetAppLock = useCallback(() => {
    persistSettings(createDefaultAppLockSettings());
    setIsLocked(false);
    backgroundedAtRef.current = null;
  }, [persistSettings]);

  const unlockWithBiometric = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const credentialId = settingsRef.current.credentialId;
    if (!credentialId) {
      return { ok: false, error: 'No biometric credential is enrolled on this device.' };
    }
    const result = await verifyPlatformBiometric(credentialId);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    setIsLocked(false);
    backgroundedAtRef.current = null;
    return { ok: true };
  }, []);

  const unlockWithPasscode = useCallback(
    async (pin: string): Promise<{ ok: boolean; error?: string }> => {
      const { passcodeHash, passcodeSalt } = settingsRef.current;
      if (!passcodeHash || !passcodeSalt) {
        return { ok: false, error: 'No backup PIN is configured.' };
      }
      const validation = validatePasscode(pin);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }
      const matches = await verifyPasscodeHash(pin, passcodeSalt, passcodeHash);
      if (!matches) {
        return { ok: false, error: 'Incorrect PIN. Please try again.' };
      }
      setIsLocked(false);
      backgroundedAtRef.current = null;
      return { ok: true };
    },
    []
  );

  return {
    settings,
    isConfigured: isAppLockConfigured(settings),
    isLocked,
    biometricSupported,
    checkingSupport,
    enrollBiometric,
    setupPasscodeLock,
    setEnabled,
    setAutoLockDelay,
    lockNow,
    resetAppLock,
    unlockWithBiometric,
    unlockWithPasscode,
  };
}
