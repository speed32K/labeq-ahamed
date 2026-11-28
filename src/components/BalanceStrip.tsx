import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import type { BalanceSnapshot, RunningBalances } from '../types/ledger';
import { formatDisplayDate, formatExcelDate, formatNum, sumBalances } from '../utils/accounting';

interface BalanceStripProps {
  selectedDate: string;
  onChangeDate: (iso: string) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  opening: BalanceSnapshot;
  closing: RunningBalances;
  isManualOpening: boolean;
  openingSourceDate: string | null;
  onOpenBalanceModal: () => void;
}

export function BalanceStrip({
  selectedDate,
  onChangeDate,
  onPrevDay,
  onNextDay,
  onToday,
  opening,
  closing,
  isManualOpening,
  openingSourceDate,
  onOpenBalanceModal,
}: BalanceStripProps) {
  const openTotal = sumBalances(opening);

  const openingLabel = isManualOpening
    ? 'Manual opening override'
    : openingSourceDate
      ? `Auto-carried from ${formatExcelDate(openingSourceDate)}`
      : 'Starting from 0.00';

  const columns: Array<{
    key: string;
    label: string;
    closingVal: number;
    openVal: number;
    isTotal?: boolean;
  }> = [
    { key: 'ko', label: 'KO Limit', closingVal: closing.ko, openVal: opening.ko },
    { key: 'cash', label: 'Cash In Hand', closingVal: closing.cash, openVal: opening.cash },
    { key: 'fino', label: 'Fino Limit', closingVal: closing.fino, openVal: opening.fino },
    { key: 'airtel', label: 'Airtel Limit', closingVal: closing.airtel, openVal: opening.airtel },
    { key: 'bank', label: 'Cash In Bank', closingVal: closing.bank, openVal: opening.bank },
    { key: 'credit', label: 'Not Paid', closingVal: closing.credit, openVal: opening.credit },
    {
      key: 'total',
      label: 'Total Net Balance',
      closingVal: closing.total,
      openVal: openTotal,
      isTotal: true,
    },
  ];

  return (
    <section
      aria-label="Date navigation and running balances"
      className="bg-white border-b border-slate-200"
    >
      {/* Toolbar Row: Date Navigation + Opening Status */}
      <div className="px-4 sm:px-6 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center border border-slate-200 rounded-lg bg-slate-50/60">
            <button
              type="button"
              onClick={onPrevDay}
              aria-label="Previous day"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-l-lg transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <input
              type="date"
              id="logDate"
              aria-label="Log Date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) onChangeDate(e.target.value);
              }}
              className="px-2 py-1.5 text-sm font-mono tabular-nums text-slate-900 bg-transparent border-x border-slate-200 focus:outline-none focus:bg-white"
            />
            <button
              type="button"
              onClick={onNextDay}
              aria-label="Next day"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-r-lg transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={onToday}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Today
          </button>

          <span className="hidden sm:inline text-sm font-medium text-slate-800 ml-1">
            {formatDisplayDate(selectedDate)}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="text-slate-500" data-testid="opening-source-label">
            {openingLabel}
          </span>
          <button
            type="button"
            onClick={onOpenBalanceModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>Edit Opening</span>
          </button>
        </div>
      </div>

      {/* 7-Column Hairline Balance Strip (crisp 1px dividers across mobile, tablet, desktop) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-slate-200">
        {columns.map((col) => (
          <div
            key={col.key}
            data-testid={`balance-${col.key}`}
            className={`px-4 py-2.5 flex flex-col justify-between min-w-0 ${
              col.isTotal ? 'bg-emerald-50 col-span-2 sm:col-span-4 lg:col-span-1' : 'bg-white'
            }`}
          >
            <span
              className={`text-xs font-medium truncate ${
                col.isTotal ? 'text-[#1f5e4b]' : 'text-slate-500'
              }`}
            >
              {col.label}
            </span>
            <span
              className={`mt-0.5 text-base sm:text-[17px] font-semibold font-mono tabular-nums tracking-tight truncate ${
                col.isTotal
                  ? 'text-[#154537]'
                  : col.closingVal < 0
                    ? 'text-red-700'
                    : 'text-slate-900'
              }`}
            >
              {formatNum(col.closingVal)}
            </span>
            <span className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500 truncate">
              Open {formatNum(col.openVal)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
