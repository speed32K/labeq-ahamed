import { Pencil, Plus, Trash2 } from 'lucide-react';
import { getGroupTextClass } from '../data/groups';
import type { RemoteEntrySyncKind } from '../lib/remoteSyncTrigger';
import type { ComputedLedgerRow, RunningBalances } from '../types/ledger';
import { formatExcelDate, formatNum, getEntryAmount } from '../utils/accounting';

interface LedgerTableProps {
  rows: ComputedLedgerRow[];
  closing: RunningBalances;
  remoteSyncedEntryIds?: Record<string, RemoteEntrySyncKind>;
  onEditEntry: (id: string) => void;
  onDeleteEntry: (row: ComputedLedgerRow) => void;
  onFocusComposer: () => void;
}

export function LedgerTable({
  rows,
  closing,
  remoteSyncedEntryIds,
  onEditEntry,
  onDeleteEntry,
  onFocusComposer,
}: LedgerTableProps) {
  const totalAmount = rows.reduce((sum, r) => sum + getEntryAmount(r), 0);

  return (
    <section
      aria-label="Excel ledger table view"
      className="flex-1 min-w-0 p-4 sm:p-6 bg-slate-50 overflow-auto"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">
            OLDTRN Excel Ledger Sheet
          </h1>
          <p className="text-xs text-slate-500">
            13-column daily log schema (Columns A–M) with unified Amount column and running balances
          </p>
        </div>
        <button
          type="button"
          onClick={onFocusComposer}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>New Entry</span>
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-xl p-8 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            No ledger rows for this date
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Add an entry in Canvas mode to populate the OLDTRN ledger sheet for this date.
          </p>
          <button
            type="button"
            onClick={onFocusComposer}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Log First Entry</span>
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table
              data-testid="excel-ledger-table"
              className="w-full border-collapse text-[11px] sm:text-xs whitespace-nowrap"
            >
              <thead>
                <tr className="bg-[#1f5e4b] text-white">
                  <th className="py-2.5 px-2 text-left font-medium">#</th>
                  <th className="py-2.5 px-2 text-left font-medium">Date</th>
                  <th className="py-2.5 px-2 text-left font-medium">Type</th>
                  <th className="py-2.5 px-2 text-left font-medium">Service Type</th>
                  <th className="py-2.5 px-2 text-left font-medium">Remarks</th>
                  <th className="py-2.5 px-2 text-left font-medium">Mode</th>
                  <th className="py-2.5 px-2 text-right font-medium">Amount</th>
                  <th className="py-2.5 px-2 text-right font-medium">KO Limit</th>
                  <th className="py-2.5 px-2 text-right font-medium">Cash Hand</th>
                  <th className="py-2.5 px-2 text-right font-medium">Fino</th>
                  <th className="py-2.5 px-2 text-right font-medium">Airtel</th>
                  <th className="py-2.5 px-2 text-right font-medium">Bank</th>
                  <th className="py-2.5 px-2 text-right font-medium">Credit</th>
                  <th className="py-2.5 px-2 text-right font-medium">Total</th>
                  <th className="py-2.5 px-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const remoteSyncKind = remoteSyncedEntryIds?.[r.id];
                  return (
                    <tr
                      key={r.id}
                      data-entry-id={r.id}
                      className={`h-10 transition-colors ${
                        remoteSyncKind
                          ? 'bg-emerald-50/70 hover:bg-emerald-50'
                          : 'hover:bg-slate-50/90'
                      }`}
                    >
                      <td className="px-2 font-mono tabular-nums text-slate-500">{r.seq}</td>
                      <td className="px-2 font-mono tabular-nums text-slate-700">
                        {formatExcelDate(r.date)}
                      </td>
                      <td className={`px-2 font-semibold ${getGroupTextClass(r.type)}`}>
                        {r.type}
                      </td>
                      <td className="px-2 font-medium text-slate-900 max-w-[190px] truncate">
                        {r.serviceType}
                        {remoteSyncKind && (
                          <span
                            data-testid="remote-synced-badge"
                            className="ml-1.5 text-[10px] font-semibold text-[#1f5e4b]"
                          >
                            ({remoteSyncKind === 'added' ? 'Remote added' : 'Remote updated'})
                          </span>
                        )}
                      </td>
                      <td className="px-2 text-slate-600 max-w-[150px] truncate">
                        {r.remarks || '—'}
                      </td>
                    <td className="px-2 text-slate-700">{r.paymentMode || 'Cash'}</td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-900 font-semibold">
                      {getEntryAmount(r) > 0 ? formatNum(getEntryAmount(r)) : ''}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-800">
                      {formatNum(r.running.ko)}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-800">
                      {formatNum(r.running.cash)}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-800">
                      {formatNum(r.running.fino)}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-800">
                      {formatNum(r.running.airtel)}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-800">
                      {formatNum(r.running.bank)}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-800">
                      {formatNum(r.running.credit)}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatNum(r.running.total)}
                    </td>
                    <td className="px-2 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => onEditEntry(r.id)}
                          aria-label={`Edit table row #${r.seq} ${r.serviceType}`}
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteEntry(r)}
                          aria-label={`Delete table row #${r.seq} ${r.serviceType}`}
                          className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-900 h-11">
                  <td colSpan={6} className="px-2 text-left text-xs text-slate-600">
                    Day Totals &amp; Closing Balances ({rows.length} entries)
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums text-slate-900">
                    {formatNum(totalAmount)}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">
                    {formatNum(closing.ko)}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">
                    {formatNum(closing.cash)}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">
                    {formatNum(closing.fino)}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">
                    {formatNum(closing.airtel)}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">
                    {formatNum(closing.bank)}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">
                    {formatNum(closing.credit)}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums text-[#154537]">
                    {formatNum(closing.total)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
