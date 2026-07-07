import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Linking,
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

const PLATFORMS: { id: Platform; label: string; hint: string }[] = [
  { id: 'sleeper', label: 'Sleeper', hint: 'Enter your Sleeper username' },
  { id: 'espn', label: 'ESPN', hint: 'League ID + espn_s2 & SWID cookies' },
  { id: 'yahoo', label: 'Yahoo', hint: 'OAuth access token from Yahoo Fantasy API' },
];

// Sleeper only supports NFL/NBA fantasy; ESPN and Yahoo support all four.
const SPORTS_BY_PLATFORM: Record<Platform, Sport[]> = {
  sleeper: ['nfl', 'nba'],
  espn: ['nfl', 'nba', 'mlb', 'nhl'],
  yahoo: ['nfl', 'nba', 'mlb', 'nhl'],
};

export default function ConnectPlatformScreen() {
  const [platform, setPlatform] = useState<Platform>('sleeper');
  const [sport, setSport] = useState<Sport>('nfl');
  const [username, setUsername] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [swid, setSwid] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [busy, setBusy] = useState(false);

  function credentials(): PlatformCredentials {
    if (platform === 'sleeper') return { username };
    if (platform === 'espn') return { leagueId, espnS2, swid };
    return { accessToken };
  }

  async function discover() {
    setBusy(true);
    try {
      await api.saveConnection(platform, credentials());
      const { leagues: found } = await api.discoverLeagues(platform, credentials(), sport);
      setLeagues(found);
      if (found.length === 0) Alert.alert('No leagues', 'No leagues found for these credentials.');
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importAll() {
    setBusy(true);
    try {
      await api.importTeams(platform, credentials(), sport);
      Alert.alert('Success', 'Teams imported and synced.');
      router.replace('/teams');
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openYahooOAuth() {
    Alert.alert(
      'Yahoo OAuth',
      'Complete Yahoo OAuth in your browser, then paste the access token below.',
      [
        {
          text: 'Open Yahoo',
          onPress: () =>
            Linking.openURL(
              'https://api.login.yahoo.com/oauth2/request_auth?client_id=YOUR_CLIENT_ID&redirect_uri=oob&response_type=code'
            ),
        },
        { text: 'OK' },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.label}>Platform</Text>
      <View style={styles.platformRow}>
        {PLATFORMS.map((p) => (
          <Pressable
            key={p.id}
            style={[styles.platformChip, platform === p.id && styles.platformChipActive]}
            onPress={() => {
              setPlatform(p.id);
              if (!SPORTS_BY_PLATFORM[p.id].includes(sport)) {
                setSport(SPORTS_BY_PLATFORM[p.id][0]);
              }
            }}
          >
            <Text style={[styles.chipText, platform === p.id && styles.chipTextActive]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Sport</Text>
      <View style={styles.platformRow}>
        {SPORTS_BY_PLATFORM[platform].map((s) => (
          <Pressable
            key={s}
            style={[styles.platformChip, sport === s && styles.platformChipActive]}
            onPress={() => setSport(s)}
          >
            <Text style={[styles.chipText, sport === s && styles.chipTextActive]}>
              {SPORT_LABELS[s]}
            </Text>
          </Pressable>
        ))}
      </View>

      {platform === 'sleeper' && (
        <TextInput
          style={styles.input}
          placeholder="Sleeper username"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
      )}

      {platform === 'espn' && (
        <>
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
            placeholder="SWID cookie"
            autoCapitalize="none"
            value={swid}
            onChangeText={setSwid}
          />
        </>
      )}

      {platform === 'yahoo' && (
        <>
          <Pressable style={styles.oauthBtn} onPress={openYahooOAuth}>
            <Text style={styles.oauthBtnText}>Connect Yahoo OAuth</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Yahoo access token"
            autoCapitalize="none"
            value={accessToken}
            onChangeText={setAccessToken}
          />
        </>
      )}

      <Pressable style={styles.button} onPress={discover} disabled={busy}>
        <Text style={styles.buttonText}>Discover Leagues</Text>
      </Pressable>

      {leagues.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Found {leagues.length} team(s)</Text>
          {leagues.map((l) => (
            <View key={`${l.externalLeagueId}-${l.externalTeamId}`} style={styles.leagueCard}>
              <Text style={styles.leagueName}>{l.leagueName}</Text>
              <Text>{l.teamName}</Text>
            </View>
          ))}
          <Pressable style={styles.button} onPress={importAll} disabled={busy}>
            <Text style={styles.buttonText}>Import All Teams</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  label: { fontWeight: '600', marginBottom: 8, color: '#333' },
  platformRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  platformChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  platformChipActive: { backgroundColor: '#1a472a', borderColor: '#1a472a' },
  chipText: { color: '#333' },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#1a472a',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  oauthBtn: {
    backgroundColor: '#720e9e',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  oauthBtnText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontWeight: '700', marginTop: 20, marginBottom: 8 },
  leagueCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  leagueName: { fontWeight: '600' },
});
