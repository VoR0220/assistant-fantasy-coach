import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform as RNPlatform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  api,
  SPORT_LABELS,
  type LeagueSummary,
  type Platform,
  type PlatformCredentials,
  type Sport,
} from '../../lib/api';

// WebView login is native-only; on web we fall back to password / username-only.
const isNative = RNPlatform.OS !== 'web';

type Step = 'choose' | 'auth' | 'leagues';

const PLATFORM_META: Record<
  Platform,
  { label: string; color: string; tagline: string }
> = {
  sleeper: {
    label: 'Sleeper',
    color: '#120e30',
    tagline: 'Sign in to enable auto lineup changes',
  },
  espn: {
    label: 'ESPN',
    color: '#c8102e',
    tagline: 'Sign in to ESPN, then paste two cookies',
  },
  yahoo: {
    label: 'Yahoo',
    color: '#5f01d1',
    tagline: 'One-click sign in with your Yahoo account',
  },
};

// Sleeper only supports NFL/NBA fantasy; ESPN and Yahoo support all four.
const SPORTS_BY_PLATFORM: Record<Platform, Sport[]> = {
  sleeper: ['nfl', 'nba'],
  espn: ['nfl', 'nba', 'mlb', 'nhl'],
  yahoo: ['nfl', 'nba', 'mlb', 'nhl'],
};

export default function ConnectPlatformScreen() {
  const params = useLocalSearchParams<{ connected?: string; error?: string }>();
  const [step, setStep] = useState<Step>('choose');
  const [platform, setPlatform] = useState<Platform>('sleeper');
  const [connected, setConnected] = useState<Set<Platform>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Auth inputs
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Sleeper: full sign-in (password → write token) vs. username-only (read-only)
  const [sleeperUsernameOnly, setSleeperUsernameOnly] = useState(false);
  const [leagueId, setLeagueId] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [swid, setSwid] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [yahooManual, setYahooManual] = useState(false);

  // League selection
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);

  const leagueKey = (l: LeagueSummary) => `${l.externalLeagueId}-${l.externalTeamId}`;

  function credentials(): PlatformCredentials | undefined {
    if (platform === 'sleeper' && username) {
      // Password unlocks the write token; without it we stay read-only.
      return sleeperUsernameOnly || !password
        ? { username }
        : { username, password };
    }
    if (platform === 'espn' && (leagueId || espnS2 || swid)) return { leagueId, espnS2, swid };
    if (platform === 'yahoo' && accessToken) return { accessToken };
    return undefined; // fall back to the saved server-side connection
  }

  const discover = useCallback(
    async (forPlatform: Platform, creds?: PlatformCredentials) => {
      setDiscovering(true);
      setError(null);
      setLeagues([]);
      try {
        const results = await Promise.allSettled(
          SPORTS_BY_PLATFORM[forPlatform].map((sport) =>
            api.discoverLeagues(forPlatform, creds, sport)
          )
        );
        const found: LeagueSummary[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled') found.push(...r.value.leagues);
        }
        const failures = results.filter((r) => r.status === 'rejected');
        if (found.length === 0 && failures.length === results.length) {
          throw (failures[0] as PromiseRejectedResult).reason;
        }
        setLeagues(found);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDiscovering(false);
      }
    },
    []
  );

  // Load existing connections; handle the Yahoo OAuth redirect return.
  useEffect(() => {
    api
      .getConnections()
      .then(({ connections }) => setConnected(new Set(connections.map((c) => c.platform))))
      .catch(() => {});

    if (params.error) {
      setError(String(params.error));
    }
    if (params.connected === 'yahoo' || params.connected === 'sleeper') {
      const p = params.connected as Platform;
      setPlatform(p);
      setConnected((prev) => new Set(prev).add(p));
      setStep('leagues');
      discover(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startAuth(p: Platform) {
    setPlatform(p);
    setError(null);
    if (connected.has(p)) {
      // Already connected — go straight to their leagues via the saved connection.
      setStep('leagues');
      discover(p);
      return;
    }
    setStep('auth');
  }

  async function signInWithYahoo() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.getYahooOAuthUrl();
      if (RNPlatform.OS === 'web') {
        window.location.href = url;
      } else {
        await Linking.openURL(url);
      }
    } catch (err) {
      // Server not configured for OAuth — offer the manual token fallback.
      setYahooManual(true);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function continueToLeagues() {
    const creds = credentials();
    if (platform === 'sleeper') {
      if (!username.trim()) {
        setError('Enter your Sleeper username.');
        return;
      }
      if (!sleeperUsernameOnly && !password) {
        setError('Enter your password, or switch to username-only mode.');
        return;
      }
    }
    if (platform === 'espn' && (!leagueId || !espnS2 || !swid)) {
      setError('League ID, espn_s2, and SWID are all required.');
      return;
    }
    if (platform === 'yahoo' && !accessToken.trim()) {
      setError('Paste your Yahoo access token, or use Sign in with Yahoo.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.saveConnection(platform, creds!);
      setConnected((prev) => new Set(prev).add(platform));
      setStep('leagues');
      await discover(platform, creds);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addLeague(league: LeagueSummary) {
    const key = leagueKey(league);
    setAddingKey(key);
    setError(null);
    try {
      await api.importTeams(platform, credentials(), league.sport, [
        {
          externalLeagueId: league.externalLeagueId,
          externalTeamId: league.externalTeamId,
        },
      ]);
      setAddedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddingKey(null);
    }
  }

  // ---------- Step 1: choose platform ----------
  if (step === 'choose') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Where do you play?</Text>
        <Text style={styles.subheading}>
          Connect a fantasy platform to import your leagues.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {(Object.keys(PLATFORM_META) as Platform[]).map((p) => (
          <Pressable
            key={p}
            style={styles.platformCard}
            onPress={() => startAuth(p)}
            disabled={busy}
          >
            <View style={[styles.platformBadge, { backgroundColor: PLATFORM_META[p].color }]}>
              <Text style={styles.platformBadgeText}>{PLATFORM_META[p].label[0]}</Text>
            </View>
            <View style={styles.platformInfo}>
              <View style={styles.platformTitleRow}>
                <Text style={styles.platformName}>{PLATFORM_META[p].label}</Text>
                {connected.has(p) && (
                  <View style={styles.connectedPill}>
                    <Text style={styles.connectedPillText}>Connected</Text>
                  </View>
                )}
              </View>
              <Text style={styles.platformTagline}>
                {connected.has(p) ? 'Tap to view your leagues' : PLATFORM_META[p].tagline}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  // ---------- Step 2: authenticate ----------
  if (step === 'auth') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Pressable onPress={() => { setStep('choose'); setError(null); }}>
          <Text style={styles.back}>‹ All platforms</Text>
        </Pressable>
        <Text style={styles.heading}>Connect {PLATFORM_META[platform].label}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {platform === 'sleeper' && (
          <>
            {isNative && !sleeperUsernameOnly && (
              <>
                <Pressable
                  style={[styles.sleeperBtn, busy && styles.btnDisabled]}
                  onPress={() => router.push('/teams/sleeper-login')}
                  disabled={busy}
                >
                  <Text style={styles.sleeperBtnText}>Sign in with Sleeper</Text>
                </Pressable>
                <Text style={styles.hint}>
                  Opens Sleeper&apos;s real login with captcha. Fast Refresh is locked off on
                  that screen so Metro can&apos;t remount the page while you type.
                </Text>
              </>
            )}
            {sleeperUsernameOnly ? (
              <>
                <Text style={styles.hint}>
                  Username-only mode reads your leagues but can&apos;t make changes for you.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Sleeper username"
                  autoCapitalize="none"
                  value={username}
                  onChangeText={setUsername}
                  onSubmitEditing={continueToLeagues}
                />
              </>
            ) : (
              <>
                <Text style={[styles.hint, isNative && { marginTop: 8 }]}>
                  {isNative
                    ? 'Fallback if the in-app browser fails (no captcha support):'
                    : 'Sign in with username and password:'}
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Sleeper username, email, or phone"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={username}
                  onChangeText={setUsername}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={continueToLeagues}
                />
              </>
            )}
            <Pressable
              onPress={() => {
                setSleeperUsernameOnly((v) => !v);
                setPassword('');
                setError(null);
              }}
            >
              <Text style={styles.toggleLink}>
                {sleeperUsernameOnly
                  ? 'Use full sign-in for auto lineup changes'
                  : 'Just browse — username only'}
              </Text>
            </Pressable>
          </>
        )}

        {platform === 'espn' && (
          <>
            <Text style={styles.hint}>
              ESPN doesn't offer app sign-in, so this takes one extra step:
            </Text>
            <Text style={styles.instruction}>1. Sign in to ESPN in your browser</Text>
            <Pressable
              style={styles.linkBtn}
              onPress={() => Linking.openURL('https://www.espn.com/login')}
            >
              <Text style={styles.linkBtnText}>Open ESPN Login</Text>
            </Pressable>
            <Text style={styles.instruction}>
              2. Open your league page and copy the league ID from the URL
            </Text>
            <Text style={styles.instruction}>
              3. In DevTools → Application → Cookies, copy espn_s2 and SWID
            </Text>
            <TextInput
              style={styles.input}
              placeholder="ESPN League ID"
              value={leagueId}
              onChangeText={setLeagueId}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="espn_s2 cookie"
              autoCapitalize="none"
              value={espnS2}
              onChangeText={setEspnS2}
            />
            <TextInput
              style={styles.input}
              placeholder="SWID cookie (including braces)"
              autoCapitalize="none"
              value={swid}
              onChangeText={setSwid}
            />
          </>
        )}

        {platform === 'yahoo' && (
          <>
            <Pressable
              style={[styles.oauthBtn, busy && styles.btnDisabled]}
              onPress={signInWithYahoo}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.oauthBtnText}>Sign in with Yahoo</Text>
              )}
            </Pressable>
            <Text style={styles.hint}>
              You'll be redirected to Yahoo to sign in, then brought back here to pick your
              leagues.
            </Text>
            {yahooManual && (
              <>
                <Text style={[styles.hint, { marginTop: 16 }]}>
                  Or paste an access token manually:
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Yahoo access token"
                  autoCapitalize="none"
                  value={accessToken}
                  onChangeText={setAccessToken}
                />
              </>
            )}
          </>
        )}

        {(platform === 'espn' ||
          platform === 'sleeper' ||
          (platform === 'yahoo' && yahooManual)) && (
          <Pressable
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={continueToLeagues}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </Pressable>
        )}

      </ScrollView>
    );
  }

  // ---------- Step 3: pick leagues ----------
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => { setStep('choose'); setError(null); }}>
        <Text style={styles.back}>‹ All platforms</Text>
      </Pressable>
      <Text style={styles.heading}>Your {PLATFORM_META[platform].label} leagues</Text>
      <Text style={styles.subheading}>Add the leagues you want the agent to manage.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {discovering && (
        <View style={styles.discovering}>
          <ActivityIndicator size="large" color="#1a472a" />
          <Text style={styles.discoveringText}>Finding your leagues…</Text>
        </View>
      )}

      {!discovering && leagues.length === 0 && !error && (
        <Text style={styles.emptyText}>
          No leagues found for this {new Date().getFullYear()} season.
        </Text>
      )}

      {leagues.map((l) => {
        const key = leagueKey(l);
        const added = addedKeys.has(key);
        const adding = addingKey === key;
        return (
          <View key={key} style={styles.leagueCard}>
            <View style={styles.leagueInfo}>
              <View style={styles.leagueTitleRow}>
                <Text style={styles.leagueName}>{l.leagueName}</Text>
                <View style={styles.sportPill}>
                  <Text style={styles.sportPillText}>{SPORT_LABELS[l.sport]}</Text>
                </View>
              </View>
              <Text style={styles.leagueTeam}>{l.teamName}</Text>
            </View>
            <Pressable
              style={[styles.addBtn, added && styles.addedBtn, adding && styles.btnDisabled]}
              onPress={() => addLeague(l)}
              disabled={added || adding}
            >
              {adding ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.addBtnText, added && styles.addedBtnText]}>
                  {added ? '✓ Added' : 'Add'}
                </Text>
              )}
            </Pressable>
          </View>
        );
      })}

      {addedKeys.size > 0 && (
        <Pressable style={styles.primaryBtn} onPress={() => router.replace('/teams')}>
          <Text style={styles.primaryBtnText}>
            Done — view {addedKeys.size} {addedKeys.size === 1 ? 'team' : 'teams'}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 24, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  subheading: { fontSize: 14, color: '#666', marginBottom: 16 },
  back: { color: '#1a472a', fontSize: 16, marginBottom: 12, fontWeight: '500' },
  error: {
    backgroundColor: '#fdecea',
    color: '#c0392b',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 14,
  },
  hint: { fontSize: 14, color: '#555', marginBottom: 12, lineHeight: 20 },
  instruction: { fontSize: 14, color: '#333', marginBottom: 8, lineHeight: 20 },
  toggleLink: {
    color: '#1a472a',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
    textDecorationLine: 'underline',
  },

  platformCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  platformBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  platformBadgeText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  platformInfo: { flex: 1 },
  platformTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  platformName: { fontSize: 17, fontWeight: '600' },
  platformTagline: { fontSize: 13, color: '#777', marginTop: 2 },
  connectedPill: {
    backgroundColor: '#e5f2e9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  connectedPillText: { color: '#1a472a', fontSize: 11, fontWeight: '600' },
  chevron: { fontSize: 26, color: '#bbb', marginLeft: 8 },

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
    backgroundColor: '#1a472a',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
    minHeight: 52,
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  btnDisabled: { opacity: 0.7 },
  linkBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#c8102e',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  linkBtnText: { color: '#c8102e', fontWeight: '600' },
  oauthBtn: {
    backgroundColor: '#5f01d1',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  oauthBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  sleeperBtn: {
    backgroundColor: '#120e30',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    marginBottom: 12,
  },
  sleeperBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },

  discovering: { alignItems: 'center', paddingVertical: 40 },
  discoveringText: { color: '#666', marginTop: 12 },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 32, paddingHorizontal: 24 },

  leagueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  leagueInfo: { flex: 1, marginRight: 12 },
  leagueTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  leagueName: { fontSize: 16, fontWeight: '600' },
  leagueTeam: { fontSize: 13, color: '#666', marginTop: 2 },
  sportPill: {
    backgroundColor: '#eef3f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sportPillText: { color: '#1a472a', fontSize: 11, fontWeight: '600' },
  addBtn: {
    backgroundColor: '#1a472a',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 84,
    alignItems: 'center',
  },
  addedBtn: { backgroundColor: '#e5f2e9' },
  addBtnText: { color: '#fff', fontWeight: '600' },
  addedBtnText: { color: '#1a472a' },
});
