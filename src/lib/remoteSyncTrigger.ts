import type { AppState, BalanceSnapshot, LogEntry } from '../types/ledger';
import { formatDisplayDate, formatNum } from '../utils/accounting';

export type RemoteEntrySyncKind = 'added' | 'updated';

export interface FirestoreEntryDocChange {
  changeType: 'added' | 'modified' | 'removed';
  hasPendingWrites: boolean;
  entry: LogEntry;
  lastModifiedByDeviceId: string | null;
  updatedAtMs: number;
}

export interface RemoteEntrySyncEvent {
  id: string;
  entryId: string;
  kind: RemoteEntrySyncKind;
  entry: LogEntry;
  sourceDeviceId: string | null;
  detectedAtMs: number;
  headline: string;
  detail: string;
}

function normalizeCustomDeltas(deltas: BalanceSnapshot | null | undefined): BalanceSnapshot | null {
  if (!deltas) return null;
  return {
    ko: Number(deltas.ko) || 0,
    cash: Number(deltas.cash) || 0,
    fino: Number(deltas.fino) || 0,
    airtel: Number(deltas.airtel) || 0,
    bank: Number(deltas.bank) || 0,
    credit: Number(deltas.credit) || 0,
  };
}

/**
 * Returns true if any user-visible accounting field of a ledger entry changed.
 * Ignores orderIndex-only reordering or serverTimestamp settlement echoes.
 */
export function haveLedgerEntryContentFieldsChanged(
  prev: LogEntry | undefined,
  next: LogEntry
): boolean {
  if (!prev) return true;
  if (
    prev.date !== next.date ||
    prev.type !== next.type ||
    prev.serviceType !== next.serviceType ||
    (prev.remarks || '') !== (next.remarks || '') ||
    (prev.paymentMode || 'Cash') !== (next.paymentMode || 'Cash') ||
    (Number(prev.debit) || 0) !== (Number(next.debit) || 0) ||
    (Number(prev.credit) || 0) !== (Number(next.credit) || 0)
  ) {
    return true;
  }

  const prevDeltas = normalizeCustomDeltas(prev.customDeltas);
  const nextDeltas = normalizeCustomDeltas(next.customDeltas);
  if (prevDeltas === null && nextDeltas === null) return false;
  if (prevDeltas === null || nextDeltas === null) return true;
  return (
    prevDeltas.ko !== nextDeltas.ko ||
    prevDeltas.cash !== nextDeltas.cash ||
    prevDeltas.fino !== nextDeltas.fino ||
    prevDeltas.airtel !== nextDeltas.airtel ||
    prevDeltas.bank !== nextDeltas.bank ||
    prevDeltas.credit !== nextDeltas.credit
  );
}

/**
 * Builds a concise human-readable summary of a ledger entry for remote-sync notifications.
 */
export function formatRemoteEntryDetail(entry: LogEntry): string {
  const amounts: string[] = [];
  if ((Number(entry.debit) || 0) > 0) amounts.push(`Dr ${formatNum(entry.debit)}`);
  if ((Number(entry.credit) || 0) > 0) amounts.push(`Cr ${formatNum(entry.credit)}`);
  const amountSuffix = amounts.length > 0 ? ` (${amounts.join(' / ')})` : '';
  const remarksSnippet = (entry.remarks || '').trim();
  const remarksPart = remarksSnippet ? ` · ${remarksSnippet}` : '';
  return `${entry.type} · ${entry.serviceType}${amountSuffix}${remarksPart}`;
}

export function buildRemoteEntrySyncEvent(params: {
  entry: LogEntry;
  kind: RemoteEntrySyncKind;
  sourceDeviceId: string | null;
  detectedAtMs: number;
}): RemoteEntrySyncEvent {
  const headline =
    params.kind === 'added'
      ? 'Remote device added an entry'
      : 'Remote device updated an entry';

  return {
    id: `${params.entry.id}:${params.kind}:${params.detectedAtMs}`,
    entryId: params.entry.id,
    kind: params.kind,
    entry: params.entry,
    sourceDeviceId: params.sourceDeviceId,
    detectedAtMs: params.detectedAtMs,
    headline,
    detail: formatRemoteEntryDetail(params.entry),
  };
}

export interface DetectRemoteSyncParams {
  initialSnapshotHandled: boolean;
  snapshotHasPendingWrites: boolean;
  currentDeviceId: string;
  previousEntriesById: ReadonlyMap<string, LogEntry>;
  changes: FirestoreEntryDocChange[];
  nowMs?: number;
}

/**
 * Inspects Firestore onSnapshot docChanges() to detect genuine remote-device entry additions
 * and updates, filtering out initial hydration, local optimistic writes, same-device echoes,
 * and orderIndex-only reorders.
 */
export function detectRemoteEntrySyncEvents(
  params: DetectRemoteSyncParams
): RemoteEntrySyncEvent[] {
  if (!params.initialSnapshotHandled) return [];
  if (params.snapshotHasPendingWrites) return [];

  const events: RemoteEntrySyncEvent[] = [];
  const fallbackNow = params.nowMs ?? Date.now();

  for (const change of params.changes) {
    if (change.changeType === 'removed') continue;
    if (change.hasPendingWrites) continue;
    if (
      change.lastModifiedByDeviceId &&
      change.lastModifiedByDeviceId === params.currentDeviceId
    ) {
      continue;
    }

    const prev = params.previousEntriesById.get(change.entry.id);
    const detectedAtMs = change.updatedAtMs > 0 ? change.updatedAtMs : fallbackNow;

    if (change.changeType === 'added') {
      if (!prev) {
        events.push(
          buildRemoteEntrySyncEvent({
            entry: change.entry,
            kind: 'added',
            sourceDeviceId: change.lastModifiedByDeviceId,
            detectedAtMs,
          })
        );
      } else if (haveLedgerEntryContentFieldsChanged(prev, change.entry)) {
        events.push(
          buildRemoteEntrySyncEvent({
            entry: change.entry,
            kind: 'updated',
            sourceDeviceId: change.lastModifiedByDeviceId,
            detectedAtMs,
          })
        );
      }
      continue;
    }

    // changeType === 'modified'
    if (haveLedgerEntryContentFieldsChanged(prev, change.entry)) {
      events.push(
        buildRemoteEntrySyncEvent({
          entry: change.entry,
          kind: 'updated',
          sourceDeviceId: change.lastModifiedByDeviceId,
          detectedAtMs,
        })
      );
    }
  }

  return events;
}

/**
 * Idempotently applies an incoming remote entry addition or update to AppState.
 * Guards against duplicate inserts on reconnection races and handles cross-date moves cleanly.
 */
export function applyRemoteEntryToAppState(
  prevState: AppState,
  entry: LogEntry,
  kind: RemoteEntrySyncKind
): AppState {
  const nextEntriesByDate: Record<string, LogEntry[]> = {};
  let existingFound = false;

  for (const [dateKey, list] of Object.entries(prevState.entriesByDate)) {
    const filtered = list.filter((item) => {
      if (item.id === entry.id) {
        existingFound = true;
        return false;
      }
      return true;
    });
    if (filtered.length > 0) {
      nextEntriesByDate[dateKey] = filtered;
    }
  }

  if (kind === 'added' && existingFound) {
    // Idempotent update in place if this entry ID was already merged
    const targetList = prevState.entriesByDate[entry.date] || [];
    const idx = targetList.findIndex((item) => item.id === entry.id);
    if (idx !== -1) {
      const updated = [...targetList];
      updated[idx] = entry;
      return {
        ...prevState,
        initialized: true,
        entriesByDate: {
          ...prevState.entriesByDate,
          [entry.date]: updated,
        },
      };
    }
  }

  if (kind === 'updated') {
    const originalList = prevState.entriesByDate[entry.date] || [];
    const originalIndex = originalList.findIndex((item) => item.id === entry.id);
    if (originalIndex !== -1) {
      const replaced = [...originalList];
      replaced[originalIndex] = entry;
      return {
        ...prevState,
        initialized: true,
        entriesByDate: {
          ...nextEntriesByDate,
          [entry.date]: replaced,
        },
      };
    }
  }

  const targetDayList = [...(nextEntriesByDate[entry.date] || []), entry];
  nextEntriesByDate[entry.date] = targetDayList;

  return {
    ...prevState,
    initialized: true,
    entriesByDate: nextEntriesByDate,
  };
}

export interface RemoteSyncBannerSummary {
  title: string;
  subtitle: string;
  primaryEvent: RemoteEntrySyncEvent;
  extraCount: number;
  editingConflict: boolean;
}

export function formatRemoteSyncBannerCopy(
  events: RemoteEntrySyncEvent[],
  editingEntryId: string | null
): RemoteSyncBannerSummary | null {
  if (events.length === 0) return null;
  const primaryEvent = events[0];
  const extraCount = Math.max(0, events.length - 1);
  const editingConflict = Boolean(
    editingEntryId && events.some((ev) => ev.entryId === editingEntryId)
  );

  let title = primaryEvent.headline;
  if (extraCount > 0) {
    const addedCount = events.filter((e) => e.kind === 'added').length;
    const updatedCount = events.filter((e) => e.kind === 'updated').length;
    if (addedCount > 0 && updatedCount > 0) {
      title = `Remote device synced ${events.length} entry changes (${addedCount} added, ${updatedCount} updated)`;
    } else if (addedCount > 0) {
      title = `Remote device added ${addedCount} entries`;
    } else {
      title = `Remote device updated ${updatedCount} entries`;
    }
  }

  const dateLabel = formatDisplayDate(primaryEvent.entry.date);
  const suffix = extraCount > 0 ? ` (+${extraCount} more)` : '';
  const subtitle = `${primaryEvent.detail} · ${dateLabel}${suffix}`;

  return {
    title,
    subtitle,
    primaryEvent,
    extraCount,
    editingConflict,
  };
}
