import { Redirect, router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { registerForPushNotifications } from '../lib/notifications';

export default function Index() {
  const { token, loading } = useAuth();

  useEffect(() => {
    if (token) {
      registerForPushNotifications().catch(console.warn);
    }
  }, [token]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1a472a" />
      </View>
    );
  }

  if (!token) return <Redirect href="/auth" />;
  return <Redirect href="/teams" />;
}
