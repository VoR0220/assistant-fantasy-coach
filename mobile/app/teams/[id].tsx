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
import { api, type Team } from '../../lib/api';

export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      const { team: t } = await api.getTeam(id);
      setTeam(t);
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setRefreshing(false);
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

  async function sync() {
    if (!id) return;
    const { team: t } = await api.syncTeam(id);
    setTeam(t);
    Alert.alert('Synced', 'Roster and free agents updated.');
  }

  if (!team) return <View style={styles.container} />;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
    >
      <View style={styles.header}>
        <Text style={styles.platform}>{team.platform.toUpperCase()}</Text>
        <Text style={styles.title}>{team.teamName}</Text>
        <Text style={styles.subtitle}>{team.leagueName}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Weekly roster agent</Text>
        <Switch value={team.agentOptIn} onValueChange={toggleOptIn} trackColor={{ true: '#1a472a' }} />
      </View>

      <Pressable style={styles.syncBtn} onPress={sync}>
        <Text style={styles.syncBtnText}>Sync Roster Now</Text>
      </Pressable>

      <Pressable
        style={styles.lineupBtn}
        onPress={async () => {
          try {
            const { recommendations } = await api.analyzeLineup(id!);
            if (recommendations.length === 0) {
              Alert.alert('Lineup OK', 'No injury subs or flex moves needed right now.');
            } else {
              Alert.alert(
                'Lineup Issues Found',
                `${recommendations.length} suggestion(s). Check Swap Ideas for details after the next agent run, or enable weekly agent.`,
                [{ text: 'View Swap Ideas', onPress: () => router.push('/recommendations') }, { text: 'OK' }]
              );
            }
          } catch (err) {
            Alert.alert('Error', (err as Error).message);
          }
        }}
      >
        <Text style={styles.lineupBtnText}>Check Injury & Flex Issues</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 16, backgroundColor: '#1a472a' },
  platform: { color: '#a8d5ba', fontSize: 12, fontWeight: '600' },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 4 },
  subtitle: { color: '#cfe8d5', marginTop: 4 },
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
});
