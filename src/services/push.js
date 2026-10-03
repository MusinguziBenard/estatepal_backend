/**
 * Expo Push Notifications.
 * Sends to Expo push tokens stored on users/devices.
 * Failures are logged, never thrown — push is best-effort.
 */

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

async function sendExpo(messages) {
  if (!messages.length) return;
  // Expo accepts batches of up to 100
  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }
  for (const chunk of chunks) {
    try {
      const res = await fetch(EXPO_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) console.warn('[push] Expo error', res.status, body);
    } catch (e) {
      console.warn('[push] network error', e.message);
    }
  }
}

function toMessages(tokens, { title, body, data }) {
  const unique = [...new Set((tokens || []).filter(Boolean))];
  return unique.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    data: data || {},
    priority: 'high',
    channelId: 'default',
  }));
}

/**
 * @param {string[]} tokens
 * @param {{ title: string, body: string, data?: object }} payload
 */
async function notify(tokens, payload) {
  const messages = toMessages(tokens, payload);
  if (!messages.length) return;
  await sendExpo(messages);
}

module.exports = { notify, sendExpo };
