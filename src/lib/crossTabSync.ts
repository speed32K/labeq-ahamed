import type { LogEntry } from '../types/ledger';
import {
  buildRemoteEntrySyncEvent,
  type RemoteEntrySyncEvent,
  type RemoteEntrySyncKind,
} from './remoteSyncTrigger';

const SYNC_CHANNEL_NAME = 'shop_daily_log_entries_sync_v1';

interface CrossTabEntryMessage {
  kind: RemoteEntrySyncKind;
  deviceId: string;
  entry: LogEntry;
  sentAtMs: number;
}

/**
 * Broadcasts an entry addition or update to other open tabs/windows on the same origin
 * via the browser BroadcastChannel API (used when running in local/unauthenticated mode;
 * authenticated sessions synchronize through Firestore onSnapshot).
 */
export function broadcastLocalEntrySync(
  deviceId: string,
  kind: RemoteEntrySyncKind,
  entry: LogEntry
): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    const message: CrossTabEntryMessage = {
      kind,
      deviceId,
      entry,
      sentAtMs: Date.now(),
    };
    channel.postMessage(message);
    channel.close();
  } catch {
    // Ignore restricted BroadcastChannel environments
  }
}

/**
 * Subscribes to cross-tab entry additions and updates emitted by other tabs/sessions.
 */
export function subscribeToCrossTabEntrySync(
  currentDeviceId: string,
  onRemoteEntry: (event: RemoteEntrySyncEvent) => void
): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return () => {};
  }

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
  } catch {
    return () => {};
  }

  const handleMessage = (msgEvent: MessageEvent<unknown>) => {
    const payload = msgEvent.data as Partial<CrossTabEntryMessage> | null;
    if (!payload || typeof payload !== 'object') return;
    if (payload.deviceId === currentDeviceId) return;
    if (payload.kind !== 'added' && payload.kind !== 'updated') return;
    if (!payload.entry || typeof payload.entry.id !== 'string') return;

    const syncEvent = buildRemoteEntrySyncEvent({
      entry: payload.entry,
      kind: payload.kind,
      sourceDeviceId: typeof payload.deviceId === 'string' ? payload.deviceId : null,
      detectedAtMs:
        typeof payload.sentAtMs === 'number' && Number.isFinite(payload.sentAtMs)
          ? payload.sentAtMs
          : Date.now(),
    });
    onRemoteEntry(syncEvent);
  };

  channel.addEventListener('message', handleMessage);

  return () => {
    channel.removeEventListener('message', handleMessage);
    try {
      channel.close();
    } catch {
      // Ignore close errors
    }
  };
}
