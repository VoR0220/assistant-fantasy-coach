import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  const Notifications = await import('expo-notifications');

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;
  await api.registerDeviceToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return token;
}

export function useNotificationDeepLink(
  onNavigate: (data: Record<string, string>) => void
) {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let subscription: { remove: () => void } | undefined;

    void import('expo-notifications').then((Notifications) => {
      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<string, string>;
        if (data?.screen) onNavigate(data);
      });
    });

    return () => subscription?.remove();
  }, [onNavigate]);
}
