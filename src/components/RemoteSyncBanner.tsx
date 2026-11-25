import { ArrowUpRight, Radio, X } from 'lucide-react';
import {
  formatRemoteSyncBannerCopy,
  type RemoteEntrySyncEvent,
} from '../lib/remoteSyncTrigger';

interface RemoteSyncBannerProps {
  events: RemoteEntrySyncEvent[];
  editingEntryId: string | null;
  onViewEntry: (event: RemoteEntrySyncEvent) => void;
  onDismiss: () => void;
}

export function RemoteSyncBanner({
  events,
  editingEntryId,
  onViewEntry,
  onDismiss,
}: RemoteSyncBannerProps) {
  const summary = formatRemoteSyncBannerCopy(events, editingEntryId);
  if (!summary) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="remote-sync-banner"
      className="bg-emerald-50 border-b border-emerald-200 px-4 sm:px-6 py-2.5 text-slate-900"
    >
      <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="mt-0.5 sm:mt-0 inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#1f5e4b] text-white shrink-0"
          >
            <Radio className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <strong
                data-testid="remote-sync-title"
                className="text-xs font-semibold text-emerald-950"
              >
                {summary.title}
              </strong>
              <span className="text-[11px] font-medium text-emerald-800">
                · State synchronized
              </span>
            </div>
            <p
              data-testid="remote-sync-detail"
              className="text-xs text-slate-700 truncate"
            >
              {summary.subtitle}
            </p>
            {summary.editingConflict && (
              <p
                data-testid="remote-sync-conflict"
                className="mt-0.5 text-[11px] font-medium text-amber-800"
              >
                Note: A remote device updated the entry currently open in your editor. Review the
                synced values before saving.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="remote-sync-view-button"
            onClick={() => onViewEntry(summary.primaryEvent)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#154537] bg-white border border-emerald-300 hover:bg-emerald-100/70 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <span>View entry</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="remote-sync-dismiss-button"
            onClick={onDismiss}
            aria-label="Dismiss remote sync notification"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-emerald-100/70 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
