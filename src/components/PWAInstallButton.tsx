import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Monitor, MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import type { InstallPlatform } from '../lib/pwa';

interface PWAInstallButtonProps {
  variant?: 'light' | 'dark';
}

export function PWAInstallButton({ variant = 'light' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, platform, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [guideTab, setGuideTab] = useState<InstallPlatform>(platform);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    setGuideTab(platform);
  }, [platform]);

  useEffect(() => {
    if (!showGuide) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowGuide(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showGuide]);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        await install();
      } finally {
        setInstalling(false);
      }
      return;
    }
    setGuideTab(platform);
    setShowGuide(true);
  };

  const buttonClasses =
    variant === 'dark'
      ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-white/10 border border-white/20 hover:bg-white/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'
      : 'inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-9 sm:h-9 md:w-auto md:h-auto md:px-2.5 md:py-2 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]';

  return (
    <>
      <button
        type="button"
        data-testid="pwa-install-button"
        disabled={installing}
        onClick={() => void handleClick()}
        aria-label="Install Shop Daily Log app"
        title={isInstallable ? 'Install Shop Daily Log app' : 'How to install on Android, iOS, or Desktop'}
        className={buttonClasses}
      >
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className={variant === 'light' ? 'hidden md:inline' : ''}>
          {installing ? 'Installing...' : 'Install App'}
        </span>
      </button>

      {showGuide &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-guide-title"
            data-testid="pwa-install-guide-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowGuide(false);
            }}
          >
          <div className="w-full max-w-md rounded-2xl bg-white text-slate-900 border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/pwa-192x192.png"
                  alt=""
                  className="w-8 h-8 rounded-lg border border-slate-200 shrink-0"
                />
                <div>
                  <h3 id="pwa-install-guide-title" className="text-sm font-semibold text-slate-900">
                    Install Shop Daily Log
                  </h3>
                  <p className="text-xs text-slate-500">
                    Run full-screen offline like a native app
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 pt-4">
              <div
                role="tablist"
                aria-label="Install platform instructions"
                className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100"
              >
                {(
                  [
                    { id: 'android', label: 'Android', icon: Smartphone },
                    { id: 'ios', label: 'iPhone / iPad', icon: Share },
                    { id: 'desktop', label: 'Desktop', icon: Monitor },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = guideTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setGuideTab(tab.id)}
                      className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-5 py-4 space-y-3 text-sm text-slate-700">
              {guideTab === 'android' && (
                <ol className="space-y-2.5 text-xs leading-relaxed">
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 text-[#1f5e4b] font-semibold shrink-0">
                      1
                    </span>
                    <span>
                      Open this app directly in <strong>Google Chrome</strong> on your Android
                      device.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 text-[#1f5e4b] font-semibold shrink-0">
                      2
                    </span>
                    <span>
                      Tap the browser menu{' '}
                      <MoreVertical className="inline w-3.5 h-3.5 -mt-0.5 text-slate-500" aria-hidden="true" />{' '}
                      in the top-right corner and choose <strong>Install app</strong> (or{' '}
                      <strong>Add to Home screen</strong>).
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 text-[#1f5e4b] font-semibold shrink-0">
                      3
                    </span>
                    <span>
                      Confirm <strong>Install</strong> to add the adaptive ShopLog icon to your
                      home screen and app drawer with full standalone launch.
                    </span>
                  </li>
                </ol>
              )}

              {guideTab === 'ios' && (
                <ol className="space-y-2.5 text-xs leading-relaxed">
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 text-[#1f5e4b] font-semibold shrink-0">
                      1
                    </span>
                    <span>
                      Open this page in <strong>Safari</strong> on your iPhone or iPad.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 text-[#1f5e4b] font-semibold shrink-0">
                      2
                    </span>
                    <span>
                      Tap the <strong>Share</strong> button{' '}
                      <Share className="inline w-3.5 h-3.5 -mt-0.5 text-slate-500" aria-hidden="true" />{' '}
                      in the Safari toolbar.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 text-[#1f5e4b] font-semibold shrink-0">
                      3
                    </span>
                    <span>
                      Scroll down, tap <strong>Add to Home Screen</strong>, then tap{' '}
                      <strong>Add</strong>.
                    </span>
                  </li>
                </ol>
              )}

              {guideTab === 'desktop' && (
                <ol className="space-y-2.5 text-xs leading-relaxed">
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 text-[#1f5e4b] font-semibold shrink-0">
                      1
                    </span>
                    <span>
                      Open the app in its own browser tab using <strong>Chrome</strong> or{' '}
                      <strong>Microsoft Edge</strong>.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 text-[#1f5e4b] font-semibold shrink-0">
                      2
                    </span>
                    <span>
                      Click the <strong>Install</strong> icon on the right side of the address bar,
                      or use the browser menu &rarr; <strong>Install Shop Daily Log Entries</strong>.
                    </span>
                  </li>
                </ol>
              )}

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
          </div>,
          document.body
        )}
    </>
  );
}
