import Constants from 'expo-constants';
import { LogBox, Platform } from 'react-native';

export type DebugLevel = 'info' | 'warn' | 'error' | 'page';

export interface DebugEntry {
  t: string;
  level: DebugLevel;
  msg: string;
  tag: string;
}

type Listener = (entries: DebugEntry[]) => void;

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string })?.apiUrl ??
  'http://localhost:5000';

// Our diagnostics must NEVER trip Expo LogBox — that red overlay is what was
// killing the Sleeper login mid-typing when a page-side Script error arrived.
LogBox.ignoreLogs(['[SleeperLogin]', '[CLIENT-DEBUG]', 'PAGE js-error']);

/** In-memory ring buffer — shared across screens so logs survive navigation. */
const buffer: DebugEntry[] = [];
const listeners = new Set<Listener>();
const MAX = 300;

function stamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function notify() {
  const snapshot = [...buffer];
  for (const l of listeners) l(snapshot);
}

/** Subscribe to live log updates (used by the floating overlay). */
export function subscribeDebugLog(listener: Listener): () => void {
  listeners.add(listener);
  listener([...buffer]);
  return () => listeners.delete(listener);
}

export function getDebugLog(): DebugEntry[] {
  return [...buffer];
}

export function clearDebugLog() {
  buffer.length = 0;
  notify();
}

/**
 * Append a log line locally AND ship it to the API server so we can read it
 * from the Mac terminal even after the login screen dies.
 */
export function debugLog(tag: string, level: DebugLevel, msg: string) {
  const entry: DebugEntry = { t: stamp(), level, msg, tag };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  notify();

  // Always console.log — console.error/warn open LogBox and interrupt WebView input.
  console.log(`[${tag}] ${entry.t} ${level.toUpperCase()} ${msg}`);

  // Fire-and-forget to the server. Must not block or throw into UI.
  try {
    fetch(`${API_URL}/api/debug/client-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...entry,
        platform: Platform.OS,
      }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}
