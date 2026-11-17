import { PushNotifications } from '@capacitor/push-notifications';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

// Must match the channel id in AndroidManifest.xml and tracker-backend/push.py.
const CHANNEL_ID = 'movimientos';

/** Firestore ids cannot hold '/', and FCM tokens are long: hash them into a stable id. */
async function deviceId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}

let current: { uid: string; id: string } | null = null;

/**
 * Asks Android for permission to notify, then saves this phone's FCM token under
 * push_tokens/{uid}/devices so the tracker can tell the owner about new movements.
 * Safe to call on every sign-in: the token document is simply overwritten.
 */
export async function enablePush(uid: string): Promise<void> {
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') return;

  await PushNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Movimientos',
    description: 'Gastos e ingresos nuevos que Flowt lee de tu banco',
    importance: 3,
    visibility: 0,
  });

  await PushNotifications.removeAllListeners();
  await PushNotifications.addListener('registration', ({ value: token }) => {
    void deviceId(token).then(async id => {
      await setDoc(doc(db, 'push_tokens', uid, 'devices', id), {
        token, platform: 'android', updated_at: serverTimestamp(),
      });
      current = { uid, id };
    }).catch(error => console.error('Push token could not be saved:', error));
  });
  await PushNotifications.addListener('registrationError', ({ error }) => {
    console.error('Push registration failed:', error);
  });
  await PushNotifications.register();
}

/** Stops notifications for this phone when its owner signs out. */
export async function disablePush(): Promise<void> {
  const device = current;
  current = null;
  if (device) await deleteDoc(doc(db, 'push_tokens', device.uid, 'devices', device.id)).catch(() => undefined);
  await PushNotifications.unregister().catch(() => undefined);
  await PushNotifications.removeAllListeners().catch(() => undefined);
}
