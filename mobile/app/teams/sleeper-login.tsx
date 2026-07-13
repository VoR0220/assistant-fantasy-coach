import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SleeperLoginView, type SleeperLoginResult } from '../../components/SleeperLoginModal';
import { api, type PlatformCredentials } from '../../lib/api';
import { holdFastRefreshDisabled } from '../../lib/disableFastRefresh';

/**
 * Hybrid Sleeper login:
 * 1) Type credentials in native TextInputs (Expo Go's "press r to reload" does
 *    NOT fire inside native inputs the way it does inside a WebView).
 * 2) Open Sleeper's page in a WebView, inject the values, user taps Sign in
 *    and completes hCaptcha with touches.
 *
 * Root cause of the mid-login death (researched):
 * https://github.com/expo/expo/issues/33905 — Expo Go reloads on hardware
 * keyboard "r". Fixed for TextInput, but maintainers note it still breaks
 * inside WebView because WKWebView is not a native text component.
 */
export default function SleeperLoginScreen() {
  const [phase, setPhase] = useState<'credentials' | 'webview'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const release = holdFastRefreshDisabled('sleeper-login-screen');
    return () => release();
  }, []);

  async function onCaptured(result: SleeperLoginResult) {
    const creds: PlatformCredentials = {
      sleeperToken: result.token,
      userId: result.userId,
    };
    setSaving(true);
    setError(null);
    try {
      await api.saveConnection('sleeper', creds);
      router.replace({
        pathname: '/teams/connect',
        params: { connected: 'sleeper' },
      });
    } catch (err) {
      setSaving(false);
      setError((err as Error).message);
    }
  }

  if (saving) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a472a" />
        <Text style={styles.savingText}>Saving Sleeper connection…</Text>
      </View>
    );
  }

  if (phase === 'webview') {
    return (
      <View style={styles.root}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <SleeperLoginView
          prefillUsername={username}
          prefillPassword={password}
          onCaptured={onCaptured}
          onClose={() => setPhase('credentials')}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Sign in to Sleeper</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.content}>
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>Simulator tip</Text>
          <Text style={styles.warningBody}>
            Expo Go reloads the app when you type the letter &quot;r&quot; into a WebView
            (known bug). Enter credentials below in native fields, then we open
            Sleeper only for captcha. Also turn off{' '}
            <Text style={styles.mono}>I/O → Keyboard → Connect Hardware Keyboard</Text> and
            use the on-screen keyboard.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.hint}>
          Your password is filled into Sleeper&apos;s page locally on device — it is not
          sent to our servers.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Sleeper username, email, or phone"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Pressable
          style={[styles.primaryBtn, (!username.trim() || !password) && styles.btnDisabled]}
          disabled={!username.trim() || !password}
          onPress={() => {
            setError(null);
            setPhase('webview');
          }}
        >
          <Text style={styles.primaryBtnText}>Continue to Sleeper captcha</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  savingText: { color: '#555', fontSize: 14 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#120e30',
  },
  cancel: { color: '#fff', fontSize: 16, minWidth: 60 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  spacer: { minWidth: 60 },
  content: { padding: 16 },
  warning: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0c36c',
  },
  warningTitle: { fontWeight: '700', color: '#7a5b00', marginBottom: 4 },
  warningBody: { color: '#7a5b00', fontSize: 13, lineHeight: 18 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11 },
  hint: { fontSize: 14, color: '#555', marginBottom: 12, lineHeight: 20 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    fontSize: 15,
  },
  primaryBtn: {
    backgroundColor: '#120e30',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  btnDisabled: { opacity: 0.5 },
  error: {
    backgroundColor: '#fdecea',
    color: '#c0392b',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 14,
  },
});
