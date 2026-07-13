import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { DebugLogOverlay } from '../components/DebugLogOverlay';
import { AuthProvider } from '../lib/auth';
import { disableFastRefresh } from '../lib/disableFastRefresh';

// Run as early as this module evaluates — before the login screen mounts.
disableFastRefresh('root-import');

export default function RootLayout() {
  useEffect(() => {
    disableFastRefresh('root-mount');
  }, []);

  return (
    <AuthProvider>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerStyle: { backgroundColor: '#1a472a' }, headerTintColor: '#fff' }}>
          <Stack.Screen name="index" options={{ title: 'Fantasy Agent' }} />
          <Stack.Screen name="auth" options={{ title: 'Sign In' }} />
          <Stack.Screen name="teams/index" options={{ title: 'My Teams' }} />
          <Stack.Screen name="teams/connect" options={{ title: 'Connect Platform' }} />
          <Stack.Screen
            name="teams/sleeper-login"
            options={{ title: 'Sleeper Sign In', headerShown: false }}
          />
          <Stack.Screen name="teams/[id]" options={{ title: 'Team' }} />
          <Stack.Screen name="recommendations/index" options={{ title: 'Swap Ideas' }} />
          <Stack.Screen name="recommendations/[id]" options={{ title: 'Recommendation' }} />
        </Stack>
        <DebugLogOverlay />
      </View>
    </AuthProvider>
  );
}
