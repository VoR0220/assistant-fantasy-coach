import { useLocalSearchParams, router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, type RosterCompliance, type Team } from '../../lib/api';

export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [compliance, setCompliance] = useState<RosterCompliance | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    setError(null);
    try {
      const { team: t, compliance: c } = await api.getTeam(id);
      setTeam(t);
      if (c) setCompliance(c);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      Alert.alert('Error', message);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function toggleOptIn(value: boolean) {
    if (!id) return;
    const { team: t } = await api.setOptIn(id, value);
    setTeam(t);
  }

  async function toggleAutoPilot(value: boolean) {
    if (!id) return;
    const { team: t } = await api.setAutoPilot(id, value);
    setTeam(t);
  }

  async function sync() {
    if (!id) return;
    const { team: t, compliance: c } = await api.syncTeam(id);
    setTeam(t);
    if (c) setCompliance(c);
    Alert.alert('Synced', 'Roster and free agents updated.');
  }

  async function generateRecommendations() {
    if (!id) return;
    setGenerating(true);
    try {
      const { recommendations, compliance: c, team: t } = await api.analyzeLineup(id);
      if (t) setTeam(t);
      if (c) setCompliance(c);
      if (recommendations.length === 0) {
        Alert.alert('All clear', 'No roster, lineup, or waiver issues found.');
      } else {
        Alert.alert(
          'Recommendations ready',
          `${recommendations.length} suggestion(s) saved to Swap Ideas.`,
          [{ text: 'View', onPress: () => router.push('/recommendations') }, { text: 'OK' }]
        );
      }
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.muted}>Loading team…</Text>
      </View>
    );
  }

  if (error || !team) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>{error ?? 'Team not found'}</Text>
        <Pressable style={styles.syncBtn} onPress={load}>
          <Text style={styles.syncBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
    >
      <View style={styles.header}>
        <Text style={styles.platform}>{team.platform.toUpperCase()}</Text>
        <Text style={styles.title}>{team.teamName}</Text>
        <Text style={styles.subtitle}>{team.leagueName}</Text>
        {compliance && compliance.maxSize > 0 && (
          <Text style={[styles.compliance, compliance.overBy > 0 && styles.complianceWarn]}>
            Roster {compliance.countable}/{compliance.maxSize}
            {compliance.taxiSlots > 0
              ? ` · Taxi ${compliance.taxiCount}/${compliance.taxiSlots}`
              : ''}
            {compliance.overBy > 0 ? ` · ${compliance.overBy} over` : ''}
          </Text>
        )}
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Weekly roster agent</Text>
        <Switch value={team.agentOptIn} onValueChange={toggleOptIn} trackColor={{ true: '#1a472a' }} />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Gameday auto-pilot</Text>
          <Text style={styles.rowHint}>
            Automatically bench OUT players and start backups at game time
          </Text>
        </View>
        <Switch
          value={team.autoPilot !== false}
          onValueChange={toggleAutoPilot}
          disabled={!team.agentOptIn}
          trackColor={{ true: '#1a472a' }}
        />
      </View>

      <Pressable style={styles.syncBtn} onPress={sync}>
        <Text style={styles.syncBtnText}>Sync Roster Now</Text>
      </Pressable>

      <Pressable style={styles.lineupBtn} onPress={generateRecommendations} disabled={generating}>
        <Text style={styles.lineupBtnText}>
          {generating ? 'Generating…' : 'Generate Swap Ideas'}
        </Text>
      </Pressable>

      <Text style={styles.section}>Starters</Text>
      {(team.roster?.starters ?? []).map((p) => (
        <View key={p.playerId} style={styles.playerRow}>
          <Text style={styles.pos}>{p.position}</Text>
          <Text style={styles.playerName}>{p.name}</Text>
        </View>
      ))}

      <Text style={styles.section}>Bench</Text>
      {(team.roster?.bench ?? []).map((p) => (
        <View key={p.playerId} style={styles.playerRow}>
          <Text style={styles.pos}>{p.position}</Text>
          <Text style={styles.playerName}>{p.name}</Text>
        </View>
      ))}

      {(team.roster?.taxi?.length ?? 0) > 0 && (
        <>
          <Text style={styles.section}>Taxi Squad</Text>
          <Text style={styles.sectionHint}>Does not count against roster limit</Text>
          {(team.roster?.taxi ?? []).map((p) => (
            <View key={p.playerId} style={[styles.playerRow, styles.taxiRow]}>
              <Text style={styles.pos}>TAXI</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{p.name}</Text>
                {p.yearsExp !== undefined && (
                  <Text style={styles.yearsExp}>{p.yearsExp} yr exp</Text>
                )}
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 16, backgroundColor: '#1a472a' },
  platform: { color: '#a8d5ba', fontSize: 12, fontWeight: '600' },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 4 },
  subtitle: { color: '#cfe8d5', marginTop: 4 },
  compliance: { color: '#a8d5ba', fontSize: 12, marginTop: 8 },
  complianceWarn: { color: '#ffd4d4', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 8,
  },
  rowLabel: { fontSize: 16, fontWeight: '500' },
  rowText: { flex: 1, marginRight: 12 },
  rowHint: { fontSize: 12, color: '#666', marginTop: 4 },
  syncBtn: {
    margin: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#1a472a',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  syncBtnText: { color: '#1a472a', fontWeight: '600' },
  lineupBtn: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#c0392b',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  lineupBtnText: { color: '#fff', fontWeight: '600' },
  section: { fontWeight: '700', fontSize: 16, marginHorizontal: 16, marginTop: 16, marginBottom: 8 },
  sectionHint: { fontSize: 12, color: '#888', marginHorizontal: 16, marginBottom: 8, marginTop: -4 },
  playerRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 6,
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  pos: { width: 36, fontWeight: '700', color: '#1a472a' },
  playerName: { flex: 1 },
  taxiRow: { borderLeftWidth: 3, borderLeftColor: '#5f01d1' },
  yearsExp: { fontSize: 11, color: '#888', marginTop: 2 },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { color: '#888' },
  errorText: { color: '#c0392b', textAlign: 'center', marginBottom: 16 },
});
