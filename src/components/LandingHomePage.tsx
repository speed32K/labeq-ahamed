import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { validateLoginEmailInput } from '../lib/ownership';
import { PWAInstallButton } from './PWAInstallButton';

interface LandingHomePageProps {
  signingIn: boolean;
  verifyingAccess: boolean;
  authError: string | null;
  onSignIn: () => void;
  onEmailLogin: (email: string) => void;
  onClearError: () => void;
}

function GoogleMark() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.87-3c-1.07.72-2.45 1.15-4.08 1.15-3.14 0-5.8-2.12-6.75-4.97H1.25v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.25 14.27a7.21 7.21 0 0 1 0-4.54V6.63H1.25a12 12 0 0 0 0 10.74l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.25 6.63l4 3.1C6.2 6.88 8.86 4.76 12 4.76z"
      />
    </svg>
  );
}

function AnimatedLedgerBackdrop() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      data-testid="animated-home-background"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#081016]"
    >
      {/* Subtle architectural ledger coordinate grid drifting on compositor transform */}
      <motion.div
        className="absolute -inset-24 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148, 163, 184, 0.24) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.24) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
        animate={
          prefersReducedMotion
            ? undefined
            : {
                x: [0, 56],
                y: [0, 56],
              }
        }
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: 'linear',
        }}
      />

      {/* Primary forest-emerald ambient light field */}
      <motion.div
        className="absolute -top-32 -left-24 w-[48rem] h-[48rem] rounded-full will-change-transform"
        style={{
          background:
            'radial-gradient(circle at center, rgba(31, 94, 75, 0.72) 0%, rgba(16, 185, 129, 0.22) 38%, rgba(8, 16, 22, 0) 72%)',
        }}
        animate={
          prefersReducedMotion
            ? undefined
            : {
                x: [0, 96, -32, 0],
                y: [0, 56, 108, 0],
                scale: [1, 1.12, 0.95, 1],
              }
        }
        transition={{
          duration: 16,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Secondary deep-teal horizon wash */}
      <motion.div
        className="absolute -bottom-44 -right-24 w-[50rem] h-[50rem] rounded-full will-change-transform"
        style={{
          background:
            'radial-gradient(circle at center, rgba(15, 118, 110, 0.58) 0%, rgba(20, 184, 166, 0.18) 42%, rgba(8, 16, 22, 0) 74%)',
        }}
        animate={
          prefersReducedMotion
            ? undefined
            : {
                x: [0, -104, 36, 0],
                y: [0, -68, -22, 0],
                scale: [1, 1.08, 0.94, 1],
              }
        }
        transition={{
          duration: 19,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Subtle warm-slate mid-canvas counterweight */}
      <motion.div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] rounded-full will-change-transform"
        style={{
          background:
            'radial-gradient(circle at center, rgba(51, 65, 85, 0.45) 0%, rgba(30, 41, 59, 0.16) 46%, rgba(8, 16, 22, 0) 72%)',
        }}
        animate={
          prefersReducedMotion
            ? undefined
            : {
                x: [-48, 64, -48],
                y: [-24, 42, -24],
                opacity: [0.6, 0.95, 0.6],
              }
        }
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Precision SVG reconciliation curves drifting across the lower viewport */}
      <svg
        className="absolute inset-x-0 bottom-0 w-full h-[52vh] opacity-60"
        viewBox="0 0 1440 420"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="ledgerCurveA" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0" />
            <stop offset="45%" stopColor="#34d399" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#1f5e4b" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ledgerCurveB" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#94a3b8" stopOpacity="0" />
            <stop offset="55%" stopColor="#cbd5e1" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#94a3b8" stopOpacity="0" />
          </linearGradient>
        </defs>

        <motion.g
          animate={prefersReducedMotion ? undefined : { y: [0, -18, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        >
          <path
            d="M-40 310 C 260 220, 520 365, 860 250 C 1110 165, 1300 225, 1490 155"
            fill="none"
            stroke="url(#ledgerCurveA)"
            strokeWidth="2.25"
          />
        </motion.g>

        <motion.g
          animate={prefersReducedMotion ? undefined : { y: [0, 14, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        >
          <path
            d="M-40 360 C 310 290, 610 215, 960 300 C 1190 355, 1330 275, 1490 240"
            fill="none"
            stroke="url(#ledgerCurveB)"
            strokeWidth="1.75"
          />
        </motion.g>
      </svg>

      {/* Edge vignette so foreground typography keeps high legibility */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 42%, transparent 25%, rgba(4, 10, 14, 0.72) 100%)',
        }}
      />
    </div>
  );
}

export function LandingHomePage({
  signingIn,
  verifyingAccess,
  authError,
  onSignIn,
  onEmailLogin,
  onClearError,
}: LandingHomePageProps) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<'google' | 'email' | null>(null);
  const isBusy = signingIn || verifyingAccess;

  const handleGoogleClick = () => {
    setEmailError(null);
    setActiveAction('google');
    onSignIn();
  };

  const handleEmailSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateLoginEmailInput(email);
    if (!validation.ok) {
      setEmailError(validation.error);
      return;
    }
    setEmailError(null);
    setActiveAction('email');
    onEmailLogin(validation.normalizedEmail);
  };

  return (
    <div
      data-testid="landing-home-page"
      className="isolate relative min-h-screen overflow-hidden flex flex-col bg-[#081016] text-slate-100 selection:bg-emerald-500/30 selection:text-white"
    >
      <AnimatedLedgerBackdrop />

      {/* Minimal single-row top header */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
        <span className="font-semibold text-base sm:text-lg tracking-tight text-white whitespace-nowrap shrink-0">
          Shop Daily Log
        </span>
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <span className="hidden sm:inline text-xs sm:text-sm text-slate-300 whitespace-nowrap">
            CSP &amp; Daily Cash Ledger
          </span>
          <PWAInstallButton variant="dark" />
        </div>
      </header>

      {/* Main focal area */}
      <main className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-5 sm:px-8 py-8 sm:py-12 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Editorial left column */}
          <div className="lg:col-span-7 space-y-6">
            <h1
              className="text-3xl sm:text-5xl font-semibold tracking-tight text-white leading-[1.12] max-w-2xl"
              style={{ textWrap: 'balance' }}
            >
              Daily cash, limits, and CSP reconciliation in one ledger.
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              Record SBI CSP, Airtel CSP, Fino, Cash, and Bank transactions with automatic AEPS
              wallet deduction, daily debit versus credit performance tracking, and instant
              cross-device sync.
            </p>

            <div className="pt-3 border-t border-white/15 grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
              <span>6 Running Wallets</span>
              <span>Atomic AEPS Deductions</span>
              <span>Live Multi-Device Sync</span>
              <span>Excel .xlsx Export</span>
            </div>
          </div>

          {/* Focal sign-in card */}
          <section
            aria-label="Workspace sign in"
            className="lg:col-span-5 w-full max-w-md lg:max-w-none mx-auto bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200/80 p-6 sm:p-8"
          >
            <div className="space-y-2">
              <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">
                Sign in to workspace
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Continue with your authorized Google account to open your daily log ledger.
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                data-testid="home-auth-error"
                className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 flex items-start gap-2.5 text-red-800"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
                <p className="text-xs leading-relaxed flex-1">{authError}</p>
                <button
                  type="button"
                  onClick={onClearError}
                  aria-label="Dismiss sign-in error"
                  className="p-0.5 text-red-500 hover:text-red-800 rounded transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            <div className="mt-6">
              <button
                type="button"
                data-testid="home-google-signin-button"
                disabled={isBusy}
                onClick={handleGoogleClick}
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-3 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-65 disabled:cursor-not-allowed shadow-xs transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
              >
                {isBusy && activeAction === 'google' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#1f5e4b]" aria-hidden="true" />
                    <span>
                      {verifyingAccess ? 'Verifying access...' : 'Continuing with Google...'}
                    </span>
                  </>
                ) : (
                  <>
                    <GoogleMark />
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              <div className="relative my-4 flex items-center" aria-hidden="true">
                <div className="flex-1 border-t border-slate-200" />
                <span className="px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  or
                </span>
                <div className="flex-1 border-t border-slate-200" />
              </div>

              <form noValidate onSubmit={handleEmailSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="home-email-input"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Email address
                  </label>
                  <div className="relative">
                    <Mail
                      className="w-4 h-4 text-slate-400 pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      id="home-email-input"
                      data-testid="home-email-input"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      disabled={signingIn}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (emailError) setEmailError(null);
                        if (authError) onClearError();
                      }}
                      placeholder="Enter your email address"
                      aria-invalid={Boolean(emailError)}
                      aria-describedby={emailError ? 'home-email-error' : undefined}
                      className={`w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl border text-sm text-slate-900 placeholder:text-slate-400 bg-white transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:cursor-not-allowed ${
                        emailError
                          ? 'border-red-500 focus:border-red-600 focus:ring-red-200'
                          : 'border-slate-300 focus:border-[#1f5e4b] focus:ring-[#1f5e4b]/25'
                      }`}
                    />
                  </div>
                  {emailError && (
                    <p
                      id="home-email-error"
                      role="alert"
                      data-testid="home-email-error"
                      className="mt-1.5 text-xs text-red-600 leading-snug"
                    >
                      {emailError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  data-testid="home-email-login-button"
                  disabled={isBusy}
                  className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] disabled:opacity-65 disabled:cursor-not-allowed shadow-sm transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
                >
                  {isBusy && activeAction === 'email' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      <span>{verifyingAccess ? 'Verifying access...' : 'Logging in...'}</span>
                    </>
                  ) : (
                    <span>Login</span>
                  )}
                </button>
              </form>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-200 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <ShieldCheck className="w-4 h-4 text-[#1f5e4b] shrink-0" aria-hidden="true" />
                <span>Authorized Gmail Access Only</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                You may only log in using the Project Primary Owner (KO) account or another
                registered account approved by the Primary Owner.
              </p>
            </div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <span>Shop Daily Log</span>
      </footer>
    </div>
  );
}
