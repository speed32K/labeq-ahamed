import { useEffect } from 'react';
import { Calendar, History, X } from 'lucide-react';
import { formatExcelDate } from '../utils/accounting';
import {
  formatSmsAmount,
  formatTotalDuesLabel,
  type CustomerPreviousDueResult,
} from '../utils/creditSms';

interface CustomerDueHistoryModalProps {
  open: boolean;
  customerName: string;
  mobileNumber: string;
  dueResult: CustomerPreviousDueResult;
  currentEntryAmount: number;
  onClose: () => void;
  onJumpToDate?: (isoDate: string) => void;
}

export function CustomerDueHistoryModal({
  open,
  customerName,
  mobileNumber,
  dueResult,
  currentEntryAmount,
  onClose,
  onJumpToDate,
}: CustomerDueHistoryModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const displayName = dueResult.matchedCustomerName || customerName || 'Customer';
  const displayMobile = dueResult.matchedMobileNumber || mobileNumber;
  const hasCurrentAmount = currentEntryAmount > 0;

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-due-history-title"
      data-testid="customer-due-history-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
              <History className="w-4 h-4 text-amber-800" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="customer-due-history-title"
                className="text-base font-semibold text-slate-900 truncate"
              >
                Customer Due History
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {displayName}
                {displayMobile ? ` · ${displayMobile}` : ''}
                {dueResult.matchedBy ? ` · Matched by ${dueResult.matchedBy}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close customer due history dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Summary KPI Strip */}
        <div
          className={`px-5 py-3.5 border-b border-slate-200 bg-white grid gap-2.5 ${
            hasCurrentAmount ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'
          }`}
        >
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="text-[11px] font-medium text-slate-500">Past Credit Entries</div>
            <div
              data-testid="due-history-count"
              className="text-sm font-mono font-semibold text-slate-900 mt-0.5"
            >
              {dueResult.matchedEntries.length}{' '}
              {dueResult.matchedEntries.length === 1 ? 'transaction' : 'transactions'}
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
            <div className="text-[11px] font-medium text-amber-900">Outstanding Previous Due</div>
            <div
              data-testid="due-history-outstanding"
              className="text-sm font-mono font-bold text-amber-950 mt-0.5"
            >
              Rs -{formatSmsAmount(dueResult.previousDue)}
            </div>
          </div>

          {hasCurrentAmount && (
            <div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2">
              <div className="text-[11px] font-medium text-red-800">
                After This Entry (Rs -{formatSmsAmount(currentEntryAmount)})
              </div>
              <div
                data-testid="due-history-projected-total"
                className="text-sm font-mono font-bold text-red-700 mt-0.5"
              >
                {formatTotalDuesLabel(dueResult.previousDue, currentEntryAmount)}
              </div>
            </div>
          )}
        </div>

        {/* Itemized Past Credit Transactions */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {dueResult.matchedEntries.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              No past unpaid credit entries found for this customer.
            </p>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2 px-3 whitespace-nowrap">Date</th>
                    <th className="py-2 px-3">Group / Service</th>
                    <th className="py-2 px-3">Remarks</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Credit Due</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Running Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dueResult.matchedEntries.map((item) => (
                    <tr
                      key={item.id}
                      data-testid="due-history-row"
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap align-top">
                        {onJumpToDate ? (
                          <button
                            type="button"
                            onClick={() => onJumpToDate(item.date)}
                            title={`Open ledger for ${formatExcelDate(item.date)}`}
                            className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-[#1f5e4b] hover:underline cursor-pointer"
                          >
                            <Calendar className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span>{formatExcelDate(item.date)}</span>
                          </button>
                        ) : (
                          <span className="font-mono text-[11px] text-slate-700">
                            {formatExcelDate(item.date)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-medium text-slate-900 leading-snug">
                          {item.serviceType}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{item.type}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 align-top max-w-[190px] break-words leading-snug">
                        {item.remarks || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-amber-900 whitespace-nowrap align-top">
                        {item.amount > 0
                          ? `Rs -${formatSmsAmount(item.amount)}`
                          : `Rs +${formatSmsAmount(Math.abs(item.amount))}`}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-red-700 whitespace-nowrap align-top">
                        Rs -{formatSmsAmount(item.runningDue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-amber-50/70 border-t border-amber-200 font-semibold text-xs">
                    <td colSpan={4} className="py-2.5 px-3 text-amber-950">
                      Verified Outstanding Previous Due
                    </td>
                    <td
                      data-testid="due-history-table-total"
                      className="py-2.5 px-3 text-right font-mono tabular-nums text-red-700 whitespace-nowrap"
                    >
                      Rs -{formatSmsAmount(dueResult.previousDue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500">
            Click any date to jump to that day&apos;s ledger entries.
          </span>
          <button
            type="button"
            onClick={onClose}
            data-testid="due-history-close-btn"
            className="px-4 py-1.5 text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
