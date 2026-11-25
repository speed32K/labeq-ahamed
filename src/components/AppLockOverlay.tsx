import { useState, type FormEvent } from 'react';
import { AlertCircle, Fingerprint, KeyRound, Loader2, Lock } from 'lucide-react';
import type { AppLockSettings } from '../lib/biometricLock';

interface AppLockOverlayProps {
  isLocked: boolean;
  settings: AppLockSettings;
  biometricSupported: boolean;
  onUnlockBiometric: () => Promise<{ ok: boolean; error?: string }>;
  onUnlockPasscode: (pin: string) => Promise<{ ok: boolean; error?: string }>;
}

export function AppLockOverlay({
  isLocked,
  settings,
  biometricSupported,
  onUnlockBiometric,
  onUnlockPasscode,
}: AppLockOverlayProps) {
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLocked) return null;

  const canUseBiometric = Boolean(settings.biometricEnrolled && settings.credentialId && biometricSupported);
  const canUsePasscode = Boolean(settings.passcodeHash && settings.passcodeSalt);

  const handleBiometricUnlock = async () => {
    setVerifying(true);
    setError(null);
    try {
      const res = await onUnlockBiometric();
      if (!res.ok) {
        setError(res.error || 'Biometric verification failed.');
      }
    } finally {
      setVerifying(false);
    }
  };

  const handlePasscodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setError(null);
    try {
      const res = await onUnlockPasscode(pin);
      if (res.ok) {
        setPin('');
      } else {
        setError(res.error || 'Incorrect PIN.');
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App Lock Authentication"
      data-testid="app-lock-overlay"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#081016] text-slate-100 p-5"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white text-slate-900 border border-slate-200 shadow-2xl p-6 sm:p-7">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#1f5e4b]/10 text-[#1f5e4b] flex items-center justify-center mb-3.5">
            {canUseBiometric ? (
              <Fingerprint className="w-6 h-6" aria-hidden="true" />
            ) : (
              <Lock className="w-6 h-6" aria-hidden="true" />
            )}
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">
            Shop Daily Log is Locked
          </h1>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            Verify your identity to access your daily balances and transaction entries.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            data-testid="app-lock-error"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 flex items-start gap-2 text-red-700"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-xs leading-snug">{error}</p>
          </div>
        )}

        <div className="mt-5 space-y-4">
          {canUseBiometric && (
            <button
              type="button"
              data-testid="unlock-biometric-button"
              disabled={verifying}
              onClick={() => void handleBiometricUnlock()}
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] disabled:opacity-60 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Verifying biometrics...</span>
                </>
              ) : (
                <>
                  <Fingerprint className="w-4 h-4" aria-hidden="true" />
                  <span>Unlock with Biometrics</span>
                </>
              )}
            </button>
          )}

          {canUseBiometric && canUsePasscode && (
            <div className="relative flex items-center" aria-hidden="true">
              <div className="flex-1 border-t border-slate-200" />
              <span className="px-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                or backup PIN
              </span>
              <div className="flex-1 border-t border-slate-200" />
            </div>
          )}

          {canUsePasscode && (
            <form onSubmit={(e) => void handlePasscodeSubmit(e)} className="space-y-3">
              <div>
                <label
                  htmlFor="app-lock-unlock-pin"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  {canUseBiometric ? 'Backup PIN' : 'App Lock PIN'}
                </label>
                <div className="relative">
                  <KeyRound
                    className="w-4 h-4 text-slate-400 pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="app-lock-unlock-pin"
                    data-testid="unlock-passcode-input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    maxLength={6}
                    value={pin}
                    disabled={verifying}
                    onChange={(e) => {
                      setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                      if (error) setError(null);
                    }}
                    placeholder="Enter 4–6 digit PIN"
                    className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-sm tracking-widest text-slate-900 placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f5e4b]/25 focus:border-[#1f5e4b]"
                  />
                </div>
              </div>

              <button
                type="submit"
                data-testid="unlock-passcode-button"
                disabled={verifying || pin.length < 4}
                className={`w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  canUseBiometric
                    ? 'text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200'
                    : 'text-white bg-[#1f5e4b] hover:bg-[#17483a]'
                }`}
              >
                <Lock className="w-4 h-4" aria-hidden="true" />
                <span>Unlock Workspace</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
