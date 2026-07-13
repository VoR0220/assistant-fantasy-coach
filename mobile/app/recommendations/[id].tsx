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
    case 'roster_drop':
      return 'Roster Cut';
    case 'move_to_taxi':
      return 'Move to Taxi';
    default:
      return 'Waiver Swap';
  }
}

function approveLabel(kind?: Recommendation['kind'], dropName?: string): string {
  switch (kind) {
    case 'roster_drop':
      return dropName ? `Drop ${dropName}` : 'Drop Player';
    case 'move_to_taxi':
      return 'Move to Taxi';
    case 'lineup_sit_start':
    case 'lineup_flex_move':
      return 'Apply Lineup Change';
    default:
      return 'Approve Swap';
  }
}

type DropChoice = NonNullable<Recommendation['dropPlayer']>;
type RationaleEntry = Recommendation['rationale'][number];

function parseRationaleLine(entry: RationaleEntry): {
  text: string;
  source: string;
  url?: string;
} {
  if (typeof entry === 'string') {
    const m = entry.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    if (m) return { text: m[1], source: m[2] };
    return { text: entry, source: 'Agent' };
  }
  return { text: entry.text, source: entry.source, url: entry.url };
}

function DropChoiceRadio({
  choices,
  selectedId,
  onSelect,
  disabled,
}: {
  choices: DropChoice[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.radioGroup}>
      <Text style={styles.label}>CHOOSE WHO TO DROP</Text>
      <Text style={styles.radioHint}>These cuts are equally good for roster compliance</Text>
      {choices.map((choice) => {
        const selected = choice.playerId === selectedId;
        return (
          <Pressable
            key={choice.playerId}
            style={[styles.radioRow, selected && styles.radioRowSelected]}
            onPress={() => !disabled && onSelect(choice.playerId)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
              {selected ? <View style={styles.radioInner} /> : null}
            </View>
            <View style={styles.radioCopy}>
              <Text style={[styles.player, styles.sit, { fontSize: 17 }]}>{choice.name}</Text>
              <Text style={styles.meta}>
                {choice.position}
                {choice.reasonTags?.includes('no_nfl_team') ? ' · no NFL team' : ''}
                {choice.reasonTags?.includes('inactive') ? ' · inactive' : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RecommendationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedDropId, setSelectedDropId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getRecommendation(id).then(({ recommendation }) => {
      setRec(recommendation);
      const alts = recommendation.dropAlternatives;
      const dropId = recommendation.dropPlayer?.playerId;
      // Prefer dropPlayer when it's among the equal choices; otherwise first alternative.
      const initialId =
        alts && alts.length > 1
          ? alts.some((a) => a.playerId === dropId)
            ? dropId!
            : alts[0].playerId
          : dropId ?? null;
      setSelectedDropId(initialId);
    }).catch(console.error);
  }, [id]);

  const dropChoices: DropChoice[] =
    rec?.dropAlternatives && rec.dropAlternatives.length > 1
      ? rec.dropAlternatives
      : rec?.dropPlayer
        ? [rec.dropPlayer]
        : [];

  const selectedDrop =
    dropChoices.find((c) => c.playerId === selectedDropId) ??
    dropChoices[0] ??
    rec?.dropPlayer ??
    null;

  async function approve() {
    if (!id) return;
    setBusy(true);
    try {
      const result = (await api.approveRecommendation(id, {
        selectedDropPlayerId: selectedDrop?.playerId,
      })) as {
        recommendation: Recommendation;
        executionResult?: { success: boolean; message: string; deepLink?: string };
      };
      setRec(result.recommendation);
      const exec = result.executionResult;
      if (exec?.deepLink) {
        Alert.alert(exec.success ? 'Success' : 'Action needed', exec.message, [
          { text: 'Open Sleeper', onPress: () => Linking.openURL(exec.deepLink!) },
          { text: 'OK' },
        ]);
      } else {
        Alert.alert(exec?.success ? 'Success' : 'Done', exec?.message ?? 'Done.');
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

  const hasEqualDrops = Boolean(rec.dropAlternatives && rec.dropAlternatives.length > 1);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.kind}>{kindTitle(rec.kind)}</Text>
      <Text style={styles.week}>Week {rec.week}</Text>

      {rec.kind === 'roster_drop' && hasEqualDrops && (
        <View style={styles.swapBox}>
          <DropChoiceRadio
            choices={dropChoices}
            selectedId={selectedDrop?.playerId ?? dropChoices[0]?.playerId}
            onSelect={setSelectedDropId}
            disabled={rec.status !== 'pending'}
          />
        </View>
      )}

      {rec.kind === 'roster_drop' && !hasEqualDrops && rec.dropPlayer && (
        <View style={styles.swapBox}>
          <Text style={styles.label}>DROP FROM ROSTER</Text>
          <Text style={[styles.player, styles.sit]}>{rec.dropPlayer.name}</Text>
          <Text style={styles.meta}>{rec.dropPlayer.position}</Text>
          {rec.dropPlayer.reasonTags?.length ? (
            <Text style={styles.tags}>{rec.dropPlayer.reasonTags.join(' · ')}</Text>
          ) : null}
        </View>
      )}

      {rec.kind === 'move_to_taxi' && rec.lineupAction?.movePlayer && (
        <View style={styles.swapBox}>
          <Text style={styles.label}>MOVE TO TAXI SQUAD</Text>
          <Text style={styles.player}>{rec.lineupAction.movePlayer.name}</Text>
          <Text style={styles.meta}>
            {rec.lineupAction.fromSlot ?? 'BN'} → TAXI
          </Text>
          <Text style={styles.tags}>Taxi players do not count against your roster limit</Text>
        </View>
      )}

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
          {hasEqualDrops ? (
            <DropChoiceRadio
              choices={dropChoices}
              selectedId={selectedDrop?.playerId ?? dropChoices[0]?.playerId}
              onSelect={setSelectedDropId}
              disabled={rec.status !== 'pending'}
            />
          ) : (
            <>
              <Text style={styles.label}>DROP</Text>
              <Text style={styles.player}>{rec.dropPlayer.name}</Text>
              <Text style={styles.meta}>{rec.dropPlayer.position}</Text>
            </>
          )}
          <Text style={[styles.label, { marginTop: 16 }]}>ADD</Text>
          <Text style={styles.player}>{rec.addPlayer.name}</Text>
          <Text style={styles.meta}>{rec.addPlayer.position}</Text>
        </View>
      )}

      <Text style={styles.section}>Why</Text>
      {rec.rationale.map((r, i) => {
        const line = parseRationaleLine(r);
        return (
          <View key={i} style={styles.rationaleBlock}>
            <Text style={styles.rationale}>• {line.text}</Text>
            <Text style={styles.citation}>
              {line.url ? (
                <Text
                  style={styles.citationLink}
                  onPress={() => Linking.openURL(line.url!)}
                >
                  Source: {line.source}
                </Text>
              ) : (
                `Source: ${line.source}`
              )}
            </Text>
          </View>
        );
      })}

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
            <Text style={styles.btnText}>
              {approveLabel(rec.kind, selectedDrop?.name)}
            </Text>
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
  rationale: { marginBottom: 2, lineHeight: 20 },
  rationaleBlock: { marginBottom: 12 },
  citation: { fontSize: 12, color: '#6b7280', marginLeft: 12, marginTop: 2, lineHeight: 16 },
  citationLink: { fontSize: 12, color: '#1a472a', textDecorationLine: 'underline' },
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
  radioGroup: { gap: 10 },
  radioHint: { fontSize: 13, color: '#666', marginTop: 4, marginBottom: 4 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    backgroundColor: '#fafafa',
  },
  radioRowSelected: {
    borderColor: '#1a472a',
    backgroundColor: '#f0f7f3',
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#aaa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: '#1a472a' },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1a472a',
  },
  radioCopy: { flex: 1 },
});
