import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api, type Recommendation } from '../../lib/api';

function kindTitle(kind?: Recommendation['kind']): string {
  switch (kind) {
    case 'lineup_sit_start':
      return 'Injury Sit / Start';
    case 'lineup_flex_move':
      return 'Flex Reposition';
    default:
      return 'Waiver Swap';
  }
}

export default function RecommendationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getRecommendations().then(({ recommendations }) => {
      const found = recommendations.find((r) => r._id === id);
      if (found) setRec(found);
    });
  }, [id]);

  async function approve() {
    if (!id) return;
    setBusy(true);
    try {
      const result = (await api.approveRecommendation(id)) as {
        recommendation: Recommendation;
        executionResult?: { success: boolean; message: string; deepLink?: string };
      };
      setRec(result.recommendation);
      const exec = result.executionResult;
      if (exec?.deepLink) {
        Alert.alert('Approved', exec.message, [
          { text: 'Open Platform', onPress: () => Linking.openURL(exec.deepLink!) },
          { text: 'OK' },
        ]);
      } else {
        Alert.alert('Approved', exec?.message ?? 'Done.');
      }
      router.back();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!id) return;
    setBusy(true);
    try {
      await api.dismissRecommendation(id);
      router.back();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!rec) return <View style={styles.container} />;

  const isLineup = rec.kind === 'lineup_sit_start' || rec.kind === 'lineup_flex_move';

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.kind}>{kindTitle(rec.kind)}</Text>
      <Text style={styles.week}>Week {rec.week}</Text>

      {rec.kind === 'lineup_flex_move' && rec.lineupAction?.movePlayer && (
        <View style={styles.swapBox}>
          <Text style={styles.label}>FLEX OPTIMIZATION</Text>
          <Text style={styles.player}>{rec.lineupAction.movePlayer.name}</Text>
          <Text style={styles.meta}>
            {rec.lineupAction.fromSlot ?? 'FLEX'} → {rec.lineupAction.toSlot}
          </Text>
          {rec.lineupAction.freesSlot && (
            <Text style={styles.tags}>Opens {rec.lineupAction.freesSlot} for injury subs</Text>
          )}
        </View>
      )}

      {rec.kind === 'lineup_sit_start' && (
        <View style={styles.swapBox}>
          {rec.lineupAction?.sitPlayer && (
            <>
              <Text style={styles.label}>SIT (INJURED / RISK)</Text>
              <Text style={[styles.player, styles.sit]}>{rec.lineupAction.sitPlayer.name}</Text>
              <Text style={styles.meta}>{rec.lineupAction.fromSlot ?? rec.lineupAction.sitPlayer.position}</Text>
            </>
          )}
          {rec.lineupAction?.startPlayer && (
            <>
              <Text style={[styles.label, { marginTop: 16 }]}>START INSTEAD</Text>
              <Text style={[styles.player, styles.start]}>{rec.lineupAction.startPlayer.name}</Text>
              <Text style={styles.meta}>{rec.lineupAction.toSlot ?? rec.lineupAction.startPlayer.position}</Text>
            </>
          )}
        </View>
      )}

      {(!rec.kind || rec.kind === 'add_drop') && rec.dropPlayer && rec.addPlayer && (
        <View style={styles.swapBox}>
          <Text style={styles.label}>DROP</Text>
          <Text style={styles.player}>{rec.dropPlayer.name}</Text>
          <Text style={styles.meta}>{rec.dropPlayer.position}</Text>
          <Text style={[styles.label, { marginTop: 16 }]}>ADD</Text>
          <Text style={styles.player}>{rec.addPlayer.name}</Text>
          <Text style={styles.meta}>{rec.addPlayer.position}</Text>
        </View>
      )}

      <Text style={styles.section}>Why</Text>
      {rec.rationale.map((r, i) => (
        <Text key={i} style={styles.rationale}>• {r}</Text>
      ))}

      {rec.newsSnippets?.length ? (
        <>
          <Text style={styles.section}>News</Text>
          {rec.newsSnippets.map((n, i) => (
            <View key={i} style={styles.newsCard}>
              <Text style={styles.newsHeadline}>{n.headline}</Text>
              <Text style={styles.newsSource}>{n.source}</Text>
            </View>
          ))}
        </>
      ) : null}

      {rec.status === 'pending' && (
        <View style={styles.actions}>
          <Pressable style={styles.approveBtn} onPress={approve} disabled={busy}>
            <Text style={styles.btnText}>{isLineup ? 'Got It — Will Fix Lineup' : 'Approve Swap'}</Text>
          </Pressable>
          <Pressable style={styles.dismissBtn} onPress={dismiss} disabled={busy}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  kind: { fontSize: 12, fontWeight: '700', color: '#1a472a' },
  week: { fontSize: 14, color: '#888', marginTop: 4 },
  swapBox: { backgroundColor: '#fff', padding: 16, borderRadius: 10, marginTop: 12 },
  label: { fontSize: 11, fontWeight: '700', color: '#888' },
  player: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  sit: { color: '#c0392b' },
  start: { color: '#1a472a' },
  meta: { color: '#666' },
  tags: { fontSize: 12, color: '#1a472a', marginTop: 8 },
  section: { fontWeight: '700', fontSize: 16, marginTop: 20, marginBottom: 8 },
  rationale: { marginBottom: 6, lineHeight: 20 },
  newsCard: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 8 },
  newsHeadline: { fontWeight: '600' },
  newsSource: { fontSize: 12, color: '#888', marginTop: 4 },
  actions: { marginTop: 24, gap: 12 },
  approveBtn: {
    backgroundColor: '#1a472a',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700' },
  dismissBtn: { padding: 16, alignItems: 'center' },
  dismissText: { color: '#c0392b', fontWeight: '600' },
});
