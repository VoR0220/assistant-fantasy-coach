import { NativeModules, TurboModuleRegistry } from 'react-native';

type DevSettingsTurbo = {
  setHotLoadingEnabled?: (enabled: boolean) => void;
};

/**
 * Stop Metro Fast Refresh from remounting the tree.
 *
 * This was killing the Sleeper login WebView mid-keystroke:
 *   input len=8 → RN unmount → "iOS Bundled"
 *
 * We hit both the native DevSettings flag and the JS HMRClient, because
 * Expo Go runs bridgeless / New Architecture where NativeModules alone
 * is unreliable.
 */
export function disableFastRefresh(reason = 'sleeper-login'): boolean {
  if (!__DEV__) return false;
  let ok = false;

  try {
    const turbo = TurboModuleRegistry.getEnforcing?.('DevSettings') as
      | DevSettingsTurbo
      | undefined;
    turbo?.setHotLoadingEnabled?.(false);
    ok = true;
  } catch {
    // fall through
  }

  try {
    NativeModules.DevSettings?.setHotLoadingEnabled?.(false);
    ok = true;
  } catch {
    // fall through
  }

  try {
    // Direct JS path — works even when the native module stub is empty.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const HMRClient = require('react-native/Libraries/Utilities/HMRClient');
    HMRClient.disable?.();
    ok = true;
  } catch {
    // fall through
  }

  if (ok) {
    console.log(`[FastRefresh] disabled (${reason})`);
  } else {
    console.warn(`[FastRefresh] FAILED to disable (${reason})`);
  }
  return ok;
}

/** Keep HMR off for the duration of a screen (re-asserts every few seconds). */
export function holdFastRefreshDisabled(reason: string): () => void {
  disableFastRefresh(reason);
  const id = setInterval(() => disableFastRefresh(`${reason}:hold`), 2000);
  return () => clearInterval(id);
}
