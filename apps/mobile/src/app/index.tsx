import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_URL } from '@/config';

type ApiState = { label: string; detail: string };

/**
 * Placeholder home screen. It exists only to prove the Expo app runs and can
 * reach the API. The real UI is built later, from the design spec.
 */
export default function HomeScreen() {
  const [api, setApi] = useState<ApiState>({ label: 'Checking…', detail: API_URL });

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { status?: string };
        setApi({
          label: response.ok && body.status === 'ok' ? 'API reachable' : 'API responded with an error',
          detail: `${API_URL} · HTTP ${response.status}`,
        });
      })
      .catch((error: unknown) => {
        setApi({
          label: 'API unreachable',
          detail: `${API_URL} · ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.title}>Doshomik Bytes</Text>
        <Text style={styles.subtitle}>Expo app scaffold. No UI built yet.</Text>

        <View style={styles.status}>
          <Text style={styles.statusLabel}>{api.label}</Text>
          <Text style={styles.statusDetail}>{api.detail}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0F' },
  safeArea: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, gap: 8 },
  title: { color: '#F5F5F7', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#A0A0AB', fontSize: 15 },
  status: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#26262F',
    backgroundColor: '#16161C',
    padding: 16,
    gap: 4,
  },
  statusLabel: { color: '#F5F5F7', fontSize: 15, fontWeight: '600' },
  statusDetail: { color: '#6B6B76', fontSize: 13 },
});
