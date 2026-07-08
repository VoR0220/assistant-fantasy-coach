import { config } from '../config/index.js';
import type { IUser } from '../models/User.js';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default';
}

export async function sendPushToUser(
  user: IUser,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (!user.deviceTokens.length) return;

  const messages: ExpoPushMessage[] = user.deviceTokens.map((dt) => ({
    to: dt.token,
    title,
    body,
    data,
    sound: 'default',
  }));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (config.expoAccessToken) {
    headers.Authorization = `Bearer ${config.expoAccessToken}`;
  }

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Push notification failed:', text);
  }
}

export async function notifyWeeklyRecommendations(
  user: IUser,
  teamName: string,
  count: number,
  week: number,
  teamId: string
): Promise<void> {
  await sendPushToUser(
    user,
    `Week ${week} roster review`,
    `${count} ${count === 1 ? 'action' : 'actions'} for ${teamName} — lineup fixes & swaps`,
    { screen: 'Recommendations', teamId, week: String(week) }
  );
}

export async function notifyAutoLineupChange(
  user: IUser,
  teamName: string,
  sitName: string,
  startName: string,
  week: number,
  teamId: string
): Promise<void> {
  await sendPushToUser(
    user,
    `Auto-pilot: ${teamName}`,
    `Benched ${sitName}, started ${startName} for week ${week}`,
    { screen: 'Recommendations', teamId, week: String(week) }
  );
}

export async function notifyUrgentLineupAlert(
  user: IUser,
  teamName: string,
  playerName: string,
  injuryStatus: string,
  deepLink: string | undefined,
  teamId: string
): Promise<void> {
  await sendPushToUser(
    user,
    `Urgent: fix ${teamName} lineup`,
    `${playerName} is ${injuryStatus}. Auto-pilot could not update your lineup — tap to fix before lock.`,
    { screen: 'Recommendations', teamId, deepLink: deepLink ?? '' }
  );
}
