export type InstallPlatform = 'android' | 'ios' | 'desktop';

export type InstallCtaMode =
  | 'hidden'
  | 'native_prompt'
  | 'ios_guide'
  | 'android_guide'
  | 'desktop_guide';

export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const ua = (userAgent || '').toLowerCase();
  if (/android/.test(ua)) {
    return 'android';
  }
  if (/iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'desktop';
}

export function isRunningStandalone(
  matchMediaStandalone: boolean,
  navigatorStandalone?: boolean
): boolean {
  return Boolean(matchMediaStandalone || navigatorStandalone === true);
}

export function getInstallCtaMode(params: {
  isInstalled: boolean;
  hasDeferredPrompt: boolean;
  platform: InstallPlatform;
}): InstallCtaMode {
  if (params.isInstalled) {
    return 'hidden';
  }
  if (params.hasDeferredPrompt) {
    return 'native_prompt';
  }
  if (params.platform === 'ios') {
    return 'ios_guide';
  }
  if (params.platform === 'android') {
    return 'android_guide';
  }
  return 'desktop_guide';
}
