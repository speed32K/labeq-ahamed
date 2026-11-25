import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { BalanceSnapshot } from '../types/ledger';
import { formatExcelDate, round2 } from '../utils/accounting';

interface OpeningBalanceModalProps {
  isOpen: boolean;
  selectedDate: string;
  initialBalances: BalanceSnapshot;
  isManual: boolean;
  onClose: () => void;
  onSave: (balances: BalanceSnapshot) => void;
  onResetAuto: () => void;
}

export function OpeningBalanceModal({
  isOpen,
  selectedDate,
  initialBalances,
  isManual,
  onClose,
  onSave,
  onResetAuto,
}: OpeningBalanceModalProps) {
  const [values, setValues] = useState<Record<keyof BalanceSnapshot, string>>({
    ko: '0',
    cash: '0',
    fino: '0',
    airtel: '0',
    bank: '0',
    credit: '0',
  });

  useEffect(() => {
    if (isOpen) {
      setValues({
        ko: String(initialBalances.ko),
        cash: String(initialBalances.cash),
        fino: String(initialBalances.fino),
        airtel: String(initialBalances.airtel),
        bank: String(initialBalances.bank),
        credit: String(initialBalances.credit),
      });
    }
  }, [isOpen, initialBalances]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave({
      ko: round2(parseFloat(values.ko) || 0),
      cash: round2(parseFloat(values.cash) || 0),
      fino: round2(parseFloat(values.fino) || 0),
      airtel: round2(parseFloat(values.airtel) || 0),
      bank: round2(parseFloat(values.bank) || 0),
      credit: round2(parseFloat(values.credit) || 0),
    });
  };

  const fields: Array<{ key: keyof BalanceSnapshot; label: string }> = [
    { key: 'ko', label: 'KO Limit' },
    { key: 'cash', label: 'Cash In Hand' },
    { key: 'fino', label: 'Fino Limit' },
    { key: 'airtel', label: 'Airtel Limit' },
    { key: 'bank', label: 'Cash In Bank' },
    { key: 'credit', label: 'Credit' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="opening-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="opening-modal-title" className="text-base font-semibold text-slate-900">
            Opening Balances for {formatExcelDate(selectedDate)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close opening balances dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            By default, opening balances carry forward from the closing balances of the previous
            logged day. Override them here if you need a custom starting balance for this date.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {fields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label
                  htmlFor={`opening-input-${f.key}`}
                  className="text-xs font-medium text-slate-700"
                >
                  {f.label}
                </label>
                <input
                  id={`opening-input-${f.key}`}
                  type="number"
                  step="0.01"
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [f.key]: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15"
                />
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={onResetAuto}
              disabled={!isManual}
              className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Use Auto Carry-Forward
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] rounded-lg transition-colors cursor-pointer"
              >
                Save Opening Balances
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
