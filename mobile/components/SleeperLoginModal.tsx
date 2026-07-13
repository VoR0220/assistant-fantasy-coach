import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import WebView, {
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';
import { debugLog, type DebugLevel } from '../lib/debugLog';
import { holdFastRefreshDisabled } from '../lib/disableFastRefresh';

export interface SleeperLoginResult {
  token: string;
  userId: string;
  displayName?: string;
}

interface Props {
  onCaptured: (result: SleeperLoginResult) => void;
  onClose: () => void;
  /** Filled into Sleeper's form via JS so the user doesn't type in the WebView. */
  prefillUsername?: string;
  prefillPassword?: string;
}

const SLEEPER_LOGIN_URL = 'https://sleeper.com/login';
const WEBVIEW_SOURCE = { uri: SLEEPER_LOGIN_URL } as const;
const TAG = 'SleeperLogin';

let mountCount = 0;

function buildPageHooks(username?: string, password?: string): string {
  const userLit = JSON.stringify(username ?? '');
  const passLit = JSON.stringify(password ?? '');
  return `
(function () {
  if (window.__sleeperHooks) return true;
  window.__sleeperHooks = true;

  function send(payload) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
  }
  function diag(msg) { send({ type: 'diag', msg: String(msg) }); }

  diag('boot ' + location.href);

  function setNativeValue(el, value) {
    if (!el) return;
    var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillCredentials() {
    var user = ${userLit};
    var pass = ${passLit};
    if (!user && !pass) return;
    var identifier =
      document.querySelector('input[name="identifier"]') ||
      document.querySelector('input[type="email"]') ||
      document.querySelector('input[type="text"]');
    var password =
      document.querySelector('input[name="password"]') ||
      document.querySelector('input[type="password"]');
    if (identifier && user) setNativeValue(identifier, user);
    if (password && pass) setNativeValue(password, pass);
    diag('prefill identifier=' + !!(identifier && user) + ' password=' + !!(password && pass));
  }

  // Sleeper is a SPA — retry fill until the login form mounts.
  var tries = 0;
  var fillId = setInterval(function () {
    tries += 1;
    fillCredentials();
    var ready = document.querySelector('input[name="identifier"], input[type="password"]');
    if (ready || tries > 40) clearInterval(fillId);
  }, 250);

  function readAuth() {
    try {
      var token = localStorage.getItem('token');
      var userId = localStorage.getItem('user_id');
      if (token && userId) {
        send({ type: 'sleeper-login', token: token, userId: userId });
        return true;
      }
    } catch (e) {}
    return false;
  }

  if (!readAuth()) {
    var ticks = 0;
    var id = setInterval(function () {
      ticks += 1;
      if (readAuth() || ticks > 900) clearInterval(id);
    }, 500);
  }

  return true;
})();
true;
`;
}

function isCaptchaChallenge(url: string): boolean {
  return /hcaptcha\.com/i.test(url) && /frame=challenge/i.test(url);
}

export function SleeperLoginView({
  onCaptured,
  onClose,
  prefillUsername,
  prefillPassword,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Loading Sleeper…');
  const [captchaVisible, setCaptchaVisible] = useState(false);
  const [popupUrl, setPopupUrl] = useState<string | null>(null);
  const captured = useRef(false);
  const webviewRef = useRef<WebView>(null);
  const firstLoadDone = useRef(false);
  const instanceId = useRef(++mountCount);
  const pageHooks = useRef(buildPageHooks(prefillUsername, prefillPassword)).current;

  const log = (level: DebugLevel, msg: string) =>
    debugLog(TAG, level, `#${instanceId.current} ${msg}`);

  useEffect(() => {
    captured.current = false;
    firstLoadDone.current = false;
    const release = holdFastRefreshDisabled('sleeper-webview');
    log('warn', 'RN mount (WebView phase — credentials prefilled)');
    const sub = AppState.addEventListener('change', (next) => {
      log('warn', `AppState -> ${next}`);
    });
    return () => {
      log('warn', 'RN unmount');
      sub.remove();
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg?.type === 'diag') {
        log('page', `PAGE ${msg.msg}`);
        return;
      }
      if (msg?.type === 'sleeper-login' && msg.token && !captured.current) {
        captured.current = true;
        log('info', `CAPTURED userId=${msg.userId}`);
        setStatus('Signed in — saving…');
        onCaptured({
          token: msg.token,
          userId: String(msg.userId ?? ''),
          displayName: msg.displayName,
        });
      }
    } catch (err) {
      log('error', `bad message: ${(err as Error).message}`);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.cancel}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Sleeper captcha</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Credentials are filled in. Tap Sign in on Sleeper&apos;s page, then complete the
          captcha with taps — avoid typing the letter &quot;r&quot; on a hardware keyboard.
        </Text>
      </View>
      <View
        style={[styles.banner, styles.captchaBanner, !captchaVisible && styles.bannerHidden]}
        pointerEvents="none"
      >
        <Text style={styles.captchaBannerText}>Captcha challenge is open — complete it here.</Text>
      </View>

      <View style={styles.webviewWrap}>
        {loading && (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator size="large" color="#1a472a" />
            <Text style={styles.loadingText}>{status}</Text>
          </View>
        )}
        <WebView
          key="sleeper-login-webview"
          ref={webviewRef}
          source={WEBVIEW_SOURCE}
          injectedJavaScript={pageHooks}
          onMessage={handleMessage}
          onLoadStart={(e) => {
            const url = (e.nativeEvent as { url?: string }).url || '?';
            log('warn', `loadStart ${url}`);
            if (!firstLoadDone.current) {
              setLoading(true);
              setStatus('Loading Sleeper…');
            }
          }}
          onLoadEnd={(e) => {
            const url = (e.nativeEvent as { url?: string }).url || '?';
            log('info', `loadEnd ${url}`);
            firstLoadDone.current = true;
            setLoading(false);
            setStatus('Tap Sign in, then complete captcha');
            // Re-run fill after SPA paint.
            webviewRef.current?.injectJavaScript(pageHooks);
          }}
          onNavigationStateChange={(nav: WebViewNavigation) => {
            if (!nav.loading) log('info', `nav url=${nav.url} title=${nav.title || ''}`);
          }}
          onHttpError={(e) => {
            log('error', `httpError ${e.nativeEvent.statusCode}`);
          }}
          onError={(e) => {
            log('error', `onError ${e.nativeEvent.description}`);
            setStatus('Failed to load — tap Retry');
            setLoading(false);
          }}
          onContentProcessDidTerminate={() => {
            log('error', 'contentProcessDidTerminate');
            setStatus('Page crashed — tap Retry');
            setLoading(false);
          }}
          onShouldStartLoadWithRequest={(req) => {
            const url = req.url || '';
            if (isCaptchaChallenge(url)) {
              log('warn', 'CAPTCHA challenge iframe');
              setCaptchaVisible(true);
            } else if (req.isTopFrame && !url.startsWith('about:')) {
              log('info', `shouldStart top ${url}`);
            }
            return true;
          }}
          setSupportMultipleWindows
          javaScriptCanOpenWindowsAutomatically
          onOpenWindow={(e) => {
            const targetUrl = e.nativeEvent.targetUrl;
            log('warn', `onOpenWindow ${targetUrl}`);
            if (/hcaptcha\.com/i.test(targetUrl)) {
              setCaptchaVisible(true);
              setPopupUrl(targetUrl);
            }
          }}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          cacheEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          originWhitelist={['*']}
          keyboardDisplayRequiresUserAction={false}
          style={styles.webview}
        />
        {status.includes('Retry') && (
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              firstLoadDone.current = false;
              setCaptchaVisible(false);
              setLoading(true);
              webviewRef.current?.reload();
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        )}
      </View>

      <Modal visible={!!popupUrl} animationType="slide" onRequestClose={() => setPopupUrl(null)}>
        <View style={styles.popupHeader}>
          <Text style={styles.popupTitle}>Captcha</Text>
          <Pressable onPress={() => setPopupUrl(null)}>
            <Text style={styles.cancel}>Done</Text>
          </Pressable>
        </View>
        {popupUrl ? (
          <WebView
            source={{ uri: popupUrl }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            originWhitelist={['*']}
          />
        ) : null}
      </Modal>
    </View>
  );
}

export function SleeperLoginModal({
  visible,
  onCaptured,
  onClose,
}: Props & { visible: boolean }) {
  if (!visible) return null;
  return <SleeperLoginView onCaptured={onCaptured} onClose={onClose} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#120e30',
  },
  cancel: { color: '#fff', fontSize: 16, minWidth: 60 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  spacer: { minWidth: 60 },
  banner: {
    backgroundColor: '#e5f2e9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a472a',
  },
  bannerHidden: { height: 0, paddingVertical: 0, overflow: 'hidden', borderBottomWidth: 0 },
  bannerText: { color: '#1a472a', fontSize: 13, lineHeight: 18 },
  captchaBanner: { backgroundColor: '#fff3cd', borderBottomColor: '#e0c36c' },
  captchaBannerText: { color: '#7a5b00', fontSize: 13 },
  webviewWrap: { flex: 1 },
  webview: { flex: 1, backgroundColor: '#fff' },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    zIndex: 1,
    gap: 12,
  },
  loadingText: { color: '#555', fontSize: 14 },
  retryBtn: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: '#120e30',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryBtnText: { color: '#fff', fontWeight: '600' },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#120e30',
  },
  popupTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
