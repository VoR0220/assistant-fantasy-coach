import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api, type Team } from '../../lib/api';

export default function TeamsScreen() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { teams: t } = await api.getTeams();
      setTeams(t);
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/teams/connect')}>
          <Text style={styles.primaryBtnText}>+ Connect Platform</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => router.push('/recommendations')}>
          <Text style={styles.secondaryBtnText}>Swap Ideas</Text>
        </Pressable>
      </View>
      <FlatList
        data={teams}
        keyExtractor={(item) => item._id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListEmptyComponent={
          <Text style={styles.empty}>No teams yet. Connect Sleeper, ESPN, or Yahoo.</Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/teams/${item._id}`)}>
            <Text style={styles.platform}>
              {item.platform.toUpperCase()} · {(item.sport ?? 'nfl').toUpperCase()}
            </Text>
            <Text style={styles.teamName}>{item.teamName}</Text>
            <Text style={styles.league}>{item.leagueName}</Text>
            <Text style={styles.optIn}>
              Weekly agent: {item.agentOptIn ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  actions: { flexDirection: 'row', gap: 8, padding: 16 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#1a472a',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#1a472a',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#1a472a', fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#1a472a',
  },
  platform: { fontSize: 11, color: '#888', fontWeight: '600' },
  teamName: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  league: { fontSize: 14, color: '#666', marginTop: 2 },
  optIn: { fontSize: 12, color: '#1a472a', marginTop: 8 },
  empty: { textAlign: 'center', color: '#888', marginTop: 40, paddingHorizontal: 24 },
});
