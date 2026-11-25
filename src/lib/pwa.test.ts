import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectInstallPlatform,
  getInstallCtaMode,
  isRunningStandalone,
} from './pwa';

test('detectInstallPlatform distinguishes Android, iOS, iPadOS, and desktop user agents', () => {
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36'
    ),
    'android'
  );
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
    ),
    'ios'
  );
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      5
    ),
    'ios'
  );
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      0
    ),
    'desktop'
  );
});

test('isRunningStandalone checks both display-mode media query and iOS navigator.standalone', () => {
  assert.equal(isRunningStandalone(true, false), true);
  assert.equal(isRunningStandalone(false, true), true);
  assert.equal(isRunningStandalone(false, undefined), false);
  assert.equal(isRunningStandalone(false, false), false);
});

test('getInstallCtaMode hides when installed, prefers native prompt, and routes platform guides', () => {
  assert.equal(
    getInstallCtaMode({ isInstalled: true, hasDeferredPrompt: true, platform: 'android' }),
    'hidden'
  );
  assert.equal(
    getInstallCtaMode({ isInstalled: false, hasDeferredPrompt: true, platform: 'android' }),
    'native_prompt'
  );
  assert.equal(
    getInstallCtaMode({ isInstalled: false, hasDeferredPrompt: true, platform: 'desktop' }),
    'native_prompt'
  );
  assert.equal(
    getInstallCtaMode({ isInstalled: false, hasDeferredPrompt: false, platform: 'ios' }),
    'ios_guide'
  );
  assert.equal(
    getInstallCtaMode({ isInstalled: false, hasDeferredPrompt: false, platform: 'android' }),
    'android_guide'
  );
  assert.equal(
    getInstallCtaMode({ isInstalled: false, hasDeferredPrompt: false, platform: 'desktop' }),
    'desktop_guide'
  );
});
