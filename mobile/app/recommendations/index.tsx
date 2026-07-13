import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, type Recommendation, type Team } from '../../lib/api';

function teamLabel(teamId: Team | string): string {
  if (typeof teamId === 'string') return '';
  return teamId.teamName;
}

function kindLabel(kind?: Recommendation['kind']): string {
  switch (kind) {
    case 'lineup_sit_start':
      return 'Sit / Start';
    case 'lineup_flex_move':
      return 'Flex Move';
    case 'roster_drop':
      return 'Roster Cut';
    case 'move_to_taxi':
      return 'Move to Taxi';
    default:
      return 'Add / Drop';
  }
}

function summaryText(item: Recommendation): { primary: string; secondary?: string } {
  if (item.kind === 'roster_drop') {
    const alts = item.dropAlternatives;
    if (alts && alts.length > 1) {
      return {
        primary: `Drop one of ${alts.length} equal options`,
        secondary: alts.map((a) => a.name).join(' · '),
      };
    }
    return {
      primary: `Drop ${item.dropPlayer?.name ?? '?'}`,
      secondary: item.dropPlayer?.position ? `${item.dropPlayer.position} · roster compliance` : undefined,
    };
  }
  if (item.kind === 'move_to_taxi') {
    const name = item.lineupAction?.movePlayer?.name ?? 'Player';
    return {
      primary: `Move ${name} to Taxi`,
      secondary: 'Does not count against roster limit',
    };
  }
  if (item.kind === 'lineup_sit_start') {
    const sit = item.lineupAction?.sitPlayer?.name ?? 'Injured player';
    const start = item.lineupAction?.startPlayer?.name;
    return {
      primary: start ? `Sit ${sit} → Start ${start}` : `Sit ${sit}`,
      secondary: item.lineupAction?.fromSlot ? `Slot: ${item.lineupAction.fromSlot}` : undefined,
    };
  }
  if (item.kind === 'lineup_flex_move') {
    const move = item.lineupAction?.movePlayer?.name ?? 'Player';
    return {
      primary: `Move ${move} to ${item.lineupAction?.toSlot ?? 'native slot'}`,
      secondary: 'Frees FLEX for subs',
    };
  }
  return {
    primary: `Drop ${item.dropPlayer?.name ?? '?'} → Add ${item.addPlayer?.name ?? '?'}`,
  };
}

export default function RecommendationsScreen() {
  const params = useLocalSearchParams<{ teamId?: string }>();
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { recommendations } = await api.getRecommendations({
        teamId: params.teamId,
        status: 'pending',
      });
      const sorted = [...recommendations].sort((a, b) => {
        const kindOrder = {
          roster_drop: 0,
          move_to_taxi: 1,
          lineup_sit_start: 2,
          lineup_flex_move: 3,
          add_drop: 4,
        };
        const aOrder = kindOrder[a.kind ?? 'add_drop'] ?? 4;
        const bOrder = kindOrder[b.kind ?? 'add_drop'] ?? 4;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return b.confidence - a.confidence;
      });
      setRecs(sorted);
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  }, [params.teamId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={recs}
        keyExtractor={(item) => item._id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No pending recommendations. Enable the weekly agent on a team for injury subs, flex
            moves, and waiver swaps.
          </Text>
        }
        renderItem={({ item }) => {
          const summary = summaryText(item);
          return (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/recommendations/${item._id}`)}
            >
              <View style={styles.badgeRow}>
                <Text style={styles.badge}>{kindLabel(item.kind)}</Text>
                <Text style={styles.week}>Week {item.week}</Text>
              </View>
              {teamLabel(item.teamId) ? (
                <Text style={styles.team}>{teamLabel(item.teamId)}</Text>
              ) : null}
              <Text style={styles.primary}>{summary.primary}</Text>
              {summary.secondary ? (
                <Text style={styles.secondary}>{summary.secondary}</Text>
              ) : null}
              <Text style={styles.confidence}>
                Confidence: {Math.round(item.confidence * 100)}%
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  empty: { textAlign: 'center', color: '#888', marginTop: 40, paddingHorizontal: 24 },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 10,
  },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#1a472a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  week: { fontSize: 12, color: '#888', fontWeight: '600' },
  team: { fontSize: 14, color: '#1a472a', marginTop: 8 },
  primary: { marginTop: 8, fontWeight: '600', fontSize: 15 },
  secondary: { marginTop: 4, fontSize: 13, color: '#666' },
  confidence: { marginTop: 8, fontSize: 12, color: '#666' },
});
