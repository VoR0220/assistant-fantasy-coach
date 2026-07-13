import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  clearDebugLog,
  subscribeDebugLog,
  type DebugEntry,
} from '../lib/debugLog';

/**
 * Floating overlay that lives at the root layout. Survives navigation away
 * from the Sleeper login screen so we can still read logs after it dies.
 */
export function DebugLogOverlay() {
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return subscribeDebugLog(setEntries);
  }, []);

  const sleeperEntries = entries.filter((e) => e.tag === 'SleeperLogin');
  if (sleeperEntries.length === 0) return null;

  if (!open) {
    return (
      <Pressable style={styles.pill} onPress={() => setOpen(true)}>
        <Text style={styles.pillText}>Logs ({sleeperEntries.length})</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.panel} pointerEvents="box-none">
      <View style={styles.panelInner}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Sleeper debug log</Text>
          <View style={styles.panelActions}>
            <Pressable onPress={() => clearDebugLog()} hitSlop={8}>
              <Text style={styles.action}>Clear</Text>
            </Pressable>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}>
              <Text style={styles.action}>Close</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView style={styles.scroll} nestedScrollEnabled>
          {sleeperEntries.map((e, i) => (
            <Text
              key={`${e.t}-${i}`}
              style={[
                styles.line,
                e.level === 'error' && styles.error,
                e.level === 'warn' && styles.warn,
              ]}
            >
              {e.t} {e.msg}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: 12,
    bottom: 36,
    backgroundColor: '#111',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 9999,
    elevation: 10,
  },
  pillText: { color: '#9f9', fontWeight: '700', fontSize: 12 },
  panel: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 9999,
    elevation: 10,
  },
  panelInner: {
    height: '45%',
    backgroundColor: '#111',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 8,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  panelTitle: { color: '#9f9', fontWeight: '700', fontSize: 13 },
  panelActions: { flexDirection: 'row', gap: 16 },
  action: { color: '#fff', fontSize: 13 },
  scroll: { flex: 1, paddingHorizontal: 12 },
  line: { color: '#ddd', fontSize: 10, fontFamily: 'Courier', marginBottom: 2 },
  warn: { color: '#fc6' },
  error: { color: '#f66' },
});
