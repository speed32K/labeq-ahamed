import { useCallback, useEffect, useState } from 'react';
import {
  detectInstallPlatform,
  getInstallCtaMode,
  isRunningStandalone,
  type InstallCtaMode,
  type InstallPlatform,
} from '../lib/pwa';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isRunningStandalone(
      window.matchMedia('(display-mode: standalone)').matches,
      (window.navigator as unknown as { standalone?: boolean }).standalone
    );
  });
  const [platform, setPlatform] = useState<InstallPlatform>(() => {
    if (typeof window === 'undefined') return 'desktop';
    return detectInstallPlatform(window.navigator.userAgent, window.navigator.maxTouchPoints);
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const syncStandalone = () => {
      setIsInstalled(
        isRunningStandalone(
          mediaQuery.matches,
          (window.navigator as unknown as { standalone?: boolean }).standalone
        )
      );
    };
    syncStandalone();

    setPlatform(detectInstallPlatform(window.navigator.userAgent, window.navigator.maxTouchPoints));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    mediaQuery.addEventListener?.('change', syncStandalone);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mediaQuery.removeEventListener?.('change', syncStandalone);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  const ctaMode: InstallCtaMode = getInstallCtaMode({
    isInstalled,
    hasDeferredPrompt: Boolean(deferredPrompt),
    platform,
  });

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
    platform,
    ctaMode,
    install,
  };
}
