import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  RotateCcw,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { UseAppLockResult } from '../hooks/useAppLock';
import {
  AUTO_LOCK_DELAY_OPTIONS,
  validatePasscode,
  type AutoLockDelayMs,
} from '../lib/biometricLock';

interface AppLockSettingsCardProps {
  user: User | null;
  appLock: UseAppLockResult;
  onStatusToast?: (message: string) => void;
}

export function AppLockSettingsCard({
  user,
  appLock,
  onStatusToast,
}: AppLockSettingsCardProps) {
  const { settings, isConfigured, biometricSupported, checkingSupport } = appLock;
  const [setupOpen, setSetupOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = () => {
    setError(null);
    if (!isConfigured) {
      setSetupOpen(true);
      return;
    }
    const nextEnabled = !settings.enabled;
    const res = appLock.setEnabled(nextEnabled);
    if (!res.ok) {
      setError(res.error || 'Could not update App Lock preference.');
      return;
    }
    onStatusToast?.(
      nextEnabled ? 'Biometric App Lock enabled.' : 'Biometric App Lock disabled.'
    );
  };

  const handleEnrollBiometric = async () => {
    setError(null);
    if (pin.trim().length > 0) {
      const check = validatePasscode(pin);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      if (pin !== confirmPin) {
        setError('Backup PIN entries do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      const res = await appLock.enrollBiometric({
        userId: user?.uid || 'local-shop-device',
        userName: user?.email || 'owner@shoplog.local',
        displayName: user?.displayName || user?.email || 'Shop Daily Log User',
        backupPin: pin.trim().length > 0 ? pin : undefined,
      });
      if (!res.ok) {
        setError(res.error || 'Could not enroll biometrics.');
        return;
      }
      setPin('');
      setConfirmPin('');
      setSetupOpen(false);
      onStatusToast?.('Biometric App Lock enrolled and enabled.');
    } finally {
      setBusy(false);
    }
  };

  const handlePasscodeSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const check = validatePasscode(pin);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (pin !== confirmPin) {
      setError('PIN entries do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await appLock.setupPasscodeLock(pin);
      if (!res.ok) {
        setError(res.error || 'Could not save PIN.');
        return;
      }
      setPin('');
      setConfirmPin('');
      setSetupOpen(false);
      onStatusToast?.('App Lock enabled.');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    appLock.resetAppLock();
    setSetupOpen(false);
    setPin('');
    setConfirmPin('');
    setError(null);
    onStatusToast?.('App Lock credentials removed and disabled.');
  };

  return (
    <section
      data-testid="app-lock-settings-section"
      className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#1f5e4b]/10 text-[#1f5e4b] flex items-center justify-center shrink-0 mt-0.5">
            <Fingerprint className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                App Lock with Biometric Authentication
              </h3>
              <span
                data-testid="app-lock-status-label"
                className={`text-[11px] font-semibold ${
                  settings.enabled ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {settings.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
              Require fingerprint, facial recognition, or your backup PIN to unlock the app after it
              has been closed or moved to the background.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Enable App Lock with Biometric Authentication"
          data-testid="app-lock-toggle"
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b] ${
            settings.enabled ? 'bg-[#1f5e4b]' : 'bg-slate-300'
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
              settings.enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* Device hardware capability status */}
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 flex items-center gap-2">
        {checkingSupport ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" aria-hidden="true" />
            <span>Checking device biometric capability...</span>
          </>
        ) : biometricSupported ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>
              Device biometric sensor detected (Fingerprint / Face ID / Platform Authenticator).
            </span>
          </>
        ) : (
          <>
            <KeyRound className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            <span>
              Hardware biometrics unavailable in this browser. Configure a 4–6 digit backup PIN now,
              or enroll biometrics on a supported mobile device.
            </span>
          </>
        )}
      </div>

      {error && (
        <div
          role="alert"
          data-testid="app-lock-settings-error"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2 text-xs text-red-700"
        >
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Unconfigured CTA */}
      {!isConfigured && !setupOpen && (
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="setup-app-lock-button"
            onClick={() => {
              setError(null);
              setSetupOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] transition-colors cursor-pointer"
          >
            <Fingerprint className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Set Up App Lock</span>
          </button>
        </div>
      )}

      {/* Inline Setup Form */}
      {setupOpen && (
        <div
          data-testid="app-lock-setup-panel"
          className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3"
        >
          {biometricSupported && (
            <div className="space-y-2">
              <button
                type="button"
                data-testid="enroll-biometric-button"
                disabled={busy}
                onClick={() => void handleEnrollBiometric()}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] disabled:opacity-60 transition-colors cursor-pointer"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Fingerprint className="w-4 h-4" aria-hidden="true" />
                )}
                <span>Enroll Fingerprint / Face ID</span>
              </button>
              <p className="text-[11px] text-slate-500">
                Optional: enter a 4–6 digit backup PIN below before enrolling so you can still unlock
                if your sensor is unavailable.
              </p>
            </div>
          )}

          <form onSubmit={(e) => void handlePasscodeSetup(e)} className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="app-lock-setup-pin"
                  className="block text-[11px] font-medium text-slate-700 mb-1"
                >
                  {biometricSupported ? 'Backup PIN (4–6 digits)' : 'App Lock PIN (4–6 digits)'}
                </label>
                <input
                  id="app-lock-setup-pin"
                  data-testid="setup-pin-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                    if (error) setError(null);
                  }}
                  placeholder="e.g. 2580"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-[#1f5e4b]"
                />
              </div>

              <div>
                <label
                  htmlFor="app-lock-setup-pin-confirm"
                  className="block text-[11px] font-medium text-slate-700 mb-1"
                >
                  Confirm PIN
                </label>
                <input
                  id="app-lock-setup-pin-confirm"
                  data-testid="setup-pin-confirm-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => {
                    setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                    if (error) setError(null);
                  }}
                  placeholder="Re-enter PIN"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-[#1f5e4b]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setSetupOpen(false);
                  setPin('');
                  setConfirmPin('');
                  setError(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="enable-passcode-lock-button"
                disabled={busy || pin.length < 4}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{biometricSupported ? 'Save PIN & Enable' : 'Enable App Lock'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Configured Controls */}
      {isConfigured && (
        <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-700">
              {settings.biometricEnrolled && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                  <Fingerprint className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Biometrics Enrolled</span>
                </span>
              )}
              {settings.passcodeHash && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                  <KeyRound className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                  <span>Backup PIN Active</span>
                </span>
              )}
            </div>

            <label className="inline-flex items-center gap-2 text-[11px] text-slate-600">
              <span>Lock when backgrounded:</span>
              <select
                data-testid="app-lock-delay-select"
                value={settings.autoLockDelayMs}
                onChange={(e) => appLock.setAutoLockDelay(Number(e.target.value) as AutoLockDelayMs)}
                className="px-2 py-1 rounded-md border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-[#1f5e4b]"
              >
                {AUTO_LOCK_DELAY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="app-lock-now-button"
                onClick={() => appLock.lockNow()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Lock Now</span>
              </button>

              {biometricSupported && !settings.biometricEnrolled && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleEnrollBiometric()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Fingerprint className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add Biometrics</span>
                </button>
              )}
            </div>

            <button
              type="button"
              data-testid="app-lock-reset-button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset Lock</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
