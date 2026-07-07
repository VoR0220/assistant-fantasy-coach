import { Stack } from 'expo-router';
import { AuthProvider } from '../lib/auth';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerStyle: { backgroundColor: '#1a472a' }, headerTintColor: '#fff' }}>
        <Stack.Screen name="index" options={{ title: 'Fantasy Agent' }} />
        <Stack.Screen name="auth" options={{ title: 'Sign In' }} />
        <Stack.Screen name="teams/index" options={{ title: 'My Teams' }} />
        <Stack.Screen name="teams/connect" options={{ title: 'Connect Platform' }} />
        <Stack.Screen name="teams/[id]" options={{ title: 'Team' }} />
        <Stack.Screen name="recommendations/index" options={{ title: 'Swap Ideas' }} />
        <Stack.Screen name="recommendations/[id]" options={{ title: 'Recommendation' }} />
      </Stack>
    </AuthProvider>
  );
}
