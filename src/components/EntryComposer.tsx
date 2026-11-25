import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ChevronDown, Plus, RotateCcw, Save } from 'lucide-react';
import { GROUP_ORDER, GROUPS } from '../data/groups';
import type { BalanceSnapshot, BusinessGroupName, LogEntry, PaymentMode } from '../types/ledger';
import {
  computeAutoDeltas,
  describeDeltas,
  formatExcelDate,
  isAepsWithdrawalService,
  isWithdrawalService,
  round2,
  sanitizeDecimalInput,
  validateWithdrawalBalance,
} from '../utils/accounting';

interface EntryComposerProps {
  selectedDate: string;
  editingEntry: LogEntry | null;
  availableBalances: BalanceSnapshot;
  savedDates: Array<{ date: string; count: number }>;
  customServicesByGroup: Record<string, string[]>;
  serviceInputRef: RefObject<HTMLInputElement | null>;
  onSubmitEntry: (entry: Omit<LogEntry, 'id'> & { id?: string }) => { ok: boolean; error?: string };
  onCancelEdit: () => void;
  onSelectDate: (iso: string) => void;
  onRequestResetAll: () => void;
}

const EMPTY_DELTAS_TEXT: Record<keyof BalanceSnapshot, string> = {
  ko: '0',
  cash: '0',
  fino: '0',
  airtel: '0',
  bank: '0',
  credit: '0',
};

export function EntryComposer({
  selectedDate,
  editingEntry,
  availableBalances,
  savedDates,
  customServicesByGroup,
  serviceInputRef,
  onSubmitEntry,
  onCancelEdit,
  onSelectDate,
  onRequestResetAll,
}: EntryComposerProps) {
  const [group, setGroup] = useState<BusinessGroupName>('SBI CSP');
  const [serviceType, setServiceType] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [remarks, setRemarks] = useState('');
  const [debit, setDebit] = useState('');
  const [credit, setCredit] = useState('');
  const [aepsAmount, setAepsAmount] = useState('');
  const [dynamicValues, setDynamicValues] = useState<Record<string, string>>({});
  const [overrideDeltas, setOverrideDeltas] = useState(false);
  const [customDeltasText, setCustomDeltasText] =
    useState<Record<keyof BalanceSnapshot, string>>(EMPTY_DELTAS_TEXT);
  const [formError, setFormError] = useState<string | null>(null);
  const [serviceDropdownOpen, setServiceDropdownOpen] = useState(false);

  const comboboxRef = useRef<HTMLDivElement | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  // Sync form when editingEntry changes
  useEffect(() => {
    if (editingEntry) {
      const safeGroup: BusinessGroupName = GROUP_ORDER.includes(
        editingEntry.type as BusinessGroupName
      )
        ? (editingEntry.type as BusinessGroupName)
        : 'SHOP';
      setGroup(safeGroup);
      setServiceType(editingEntry.serviceType || '');
      const safeMode: PaymentMode =
        editingEntry.paymentMode === 'ONLINE' || editingEntry.paymentMode === 'CREDIT'
          ? editingEntry.paymentMode
          : 'Cash';
      setPaymentMode(safeMode);
      setRemarks(editingEntry.remarks || '');
      const editingIsAeps = isAepsWithdrawalService(editingEntry.serviceType || '');
      setDebit(editingEntry.debit ? String(editingEntry.debit) : '');
      setCredit(editingEntry.credit ? String(editingEntry.credit) : '');
      setAepsAmount(
        editingIsAeps
          ? String(editingEntry.debit || editingEntry.credit || '')
          : ''
      );
      setDynamicValues({});
      if (editingEntry.customDeltas) {
        setOverrideDeltas(true);
        setCustomDeltasText({
          ko: String(editingEntry.customDeltas.ko),
          cash: String(editingEntry.customDeltas.cash),
          fino: String(editingEntry.customDeltas.fino),
          airtel: String(editingEntry.customDeltas.airtel),
          bank: String(editingEntry.customDeltas.bank),
          credit: String(editingEntry.customDeltas.credit),
        });
      } else {
        setOverrideDeltas(false);
        setCustomDeltasText(EMPTY_DELTAS_TEXT);
      }
      setFormError(null);
    }
  }, [editingEntry]);

  // Close service suggestion dropdown on outside click
  useEffect(() => {
    if (!serviceDropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setServiceDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [serviceDropdownOpen]);

  const groupDef = GROUPS[group];

  const availableServices = useMemo(() => {
    const base = groupDef.services;
    const extras = customServicesByGroup[group] || [];
    return Array.from(new Set([...base, ...extras]));
  }, [group, groupDef, customServicesByGroup]);

  const filteredServices = useMemo(() => {
    const q = serviceType.trim().toLowerCase();
    if (!q) return availableServices;
    const exactMatch = availableServices.some((s) => s.toLowerCase() === q);
    if (exactMatch) return availableServices;
    return availableServices.filter((s) => s.toLowerCase().includes(q));
  }, [availableServices, serviceType]);

  // Toggle simplified "Amount" mode immediately when "AEPS WITHDRAWAL" is selected
  const isAepsWithdrawal = isAepsWithdrawalService(serviceType);

  const parsedDebit = isAepsWithdrawal
    ? round2(parseFloat(aepsAmount) || 0)
    : round2(parseFloat(debit) || 0);
  const parsedCredit = isAepsWithdrawal ? 0 : round2(parseFloat(credit) || 0);
  const effectivePaymentMode: PaymentMode = isAepsWithdrawal ? 'Cash' : paymentMode;

  const autoDeltas = useMemo(
    () =>
      computeAutoDeltas({
        type: group,
        serviceType,
        paymentMode: effectivePaymentMode,
        debit: parsedDebit,
        credit: parsedCredit,
      }),
    [group, serviceType, effectivePaymentMode, parsedDebit, parsedCredit]
  );

  const effectiveDeltas: BalanceSnapshot = useMemo(() => {
    if (!overrideDeltas) return autoDeltas;
    return {
      ko: round2(parseFloat(customDeltasText.ko) || 0),
      cash: round2(parseFloat(customDeltasText.cash) || 0),
      fino: round2(parseFloat(customDeltasText.fino) || 0),
      airtel: round2(parseFloat(customDeltasText.airtel) || 0),
      bank: round2(parseFloat(customDeltasText.bank) || 0),
      credit: round2(parseFloat(customDeltasText.credit) || 0),
    };
  }, [overrideDeltas, customDeltasText, autoDeltas]);

  const impactParts = useMemo(() => describeDeltas(effectiveDeltas), [effectiveDeltas]);

  const handleGroupChange = (nextGroup: BusinessGroupName) => {
    setGroup(nextGroup);
    setDynamicValues({});
    setFormError(null);
    if (!editingEntry) {
      setServiceType('');
    }
  };

  const handleDynamicFieldChange = (fieldId: string, value: string) => {
    const next = { ...dynamicValues, [fieldId]: value };
    setDynamicValues(next);

    // Auto-calculate Qty * Unit Rate for SHOP
    if (group === 'SHOP' && (fieldId === 'dynQty' || fieldId === 'dynUnitRate')) {
      const q = parseFloat(next.dynQty || '');
      const r = parseFloat(next.dynUnitRate || '');
      if (!Number.isNaN(q) && !Number.isNaN(r) && q > 0 && r > 0) {
        const computed = round2(q * r).toFixed(2);
        const svcUpper = serviceType.toUpperCase();
        const isExpenseLike =
          svcUpper.includes('EXPENSE') ||
          svcUpper.includes('PAYMENT') ||
          svcUpper.includes('WITHDRAWAL');
        if (isExpenseLike) {
          setDebit(computed);
          setCredit('');
        } else {
          setCredit(computed);
          setDebit('');
        }
        setFormError(null);
      }
    }
  };

  const handleToggleOverride = (checked: boolean) => {
    setOverrideDeltas(checked);
    if (checked) {
      setCustomDeltasText({
        ko: String(autoDeltas.ko),
        cash: String(autoDeltas.cash),
        fino: String(autoDeltas.fino),
        airtel: String(autoDeltas.airtel),
        bank: String(autoDeltas.bank),
        credit: String(autoDeltas.credit),
      });
    }
  };

  const resetLocalFields = () => {
    setServiceType('');
    setRemarks('');
    setDebit('');
    setCredit('');
    setAepsAmount('');
    setDynamicValues({});
    setOverrideDeltas(false);
    setCustomDeltasText(EMPTY_DELTAS_TEXT);
    setFormError(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const trimmedService = serviceType.trim();
    if (!trimmedService) {
      setFormError('Please select or type a Service Type.');
      serviceInputRef.current?.focus();
      return;
    }

    if (isAepsWithdrawal) {
      if (parsedDebit <= 0) {
        setFormError('Enter an Amount greater than 0.');
        amountInputRef.current?.focus();
        return;
      }
    } else if (parsedDebit <= 0 && parsedCredit <= 0) {
      setFormError('Enter a Debit or Credit amount greater than 0.');
      return;
    }

    // Validate sufficient balance on the selected group for withdrawal transactions
    if (!overrideDeltas && isWithdrawalService(trimmedService)) {
      const withdrawalAmt = parsedDebit > 0 ? parsedDebit : parsedCredit;
      const check = validateWithdrawalBalance(
        availableBalances,
        group,
        trimmedService,
        withdrawalAmt,
        effectivePaymentMode
      );
      if (!check.valid) {
        setFormError(check.error || 'Insufficient group balance for withdrawal.');
        if (isAepsWithdrawal) amountInputRef.current?.focus();
        return;
      }
    }

    // Merge dynamic field details into Remarks
    let finalRemarks = remarks.trim();
    const dynNotes: string[] = [];
    for (const f of groupDef.dynamicFields) {
      if (f.id === 'dynQty' || f.id === 'dynUnitRate') continue;
      const val = (dynamicValues[f.id] || '').trim();
      if (val) dynNotes.push(val);
    }
    if (group === 'SHOP') {
      const q = (dynamicValues.dynQty || '').trim();
      const r = (dynamicValues.dynUnitRate || '').trim();
      if (q && r) dynNotes.push(`${q}x${r}`);
    }
    if (dynNotes.length) {
      finalRemarks = finalRemarks
        ? `${finalRemarks} (${dynNotes.join(', ')})`
        : dynNotes.join(', ');
    }

    const result = onSubmitEntry({
      id: editingEntry?.id,
      date: selectedDate,
      type: group,
      serviceType: trimmedService,
      remarks: finalRemarks,
      paymentMode: effectivePaymentMode,
      debit: parsedDebit,
      credit: parsedCredit,
      customDeltas: overrideDeltas ? effectiveDeltas : null,
    });

    if (!result.ok) {
      setFormError(result.error || 'Could not apply ledger entry.');
      if (isAepsWithdrawal) amountInputRef.current?.focus();
      return;
    }

    resetLocalFields();
  };

  const deltaInputs: Array<{ key: keyof BalanceSnapshot; label: string }> = [
    { key: 'ko', label: 'Δ KO Limit' },
    { key: 'cash', label: 'Δ Cash Hand' },
    { key: 'fino', label: 'Δ Fino' },
    { key: 'airtel', label: 'Δ Airtel' },
    { key: 'bank', label: 'Δ Bank' },
    { key: 'credit', label: 'Δ Credit' },
  ];

  return (
    <aside
      aria-label="Log entry composer"
      className="w-full lg:w-[356px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col"
    >
      <div className="p-4 flex-1 flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold text-slate-900">
            {editingEntry ? 'Edit Log Entry' : 'New Log Entry'}
          </h1>
          {editingEntry && (
            <button
              type="button"
              onClick={() => {
                onCancelEdit();
                resetLocalFields();
              }}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2.5 py-1 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel Edit
            </button>
          )}
        </div>

        {/* Interactive Business Group Selector */}
        <div>
          <span className="block text-xs font-medium text-slate-600 mb-1.5">
            Business Group (Txncat)
          </span>
          <div
            role="tablist"
            aria-label="Business groups"
            className="grid grid-cols-2 gap-1.5"
          >
            {GROUP_ORDER.map((gName) => {
              const def = GROUPS[gName];
              const active = group === gName;
              return (
                <button
                  key={gName}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleGroupChange(gName)}
                  className={`px-2.5 py-1.5 rounded-lg text-left text-xs font-medium border transition-colors truncate cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1f5e4b] ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50/70 text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {def.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Entry Form */}
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          {/* Service Type Combobox */}
          <div ref={comboboxRef} className="relative">
            <label
              htmlFor="serviceTypeInput"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Service Type
            </label>
            <div className="relative">
              <input
                ref={serviceInputRef}
                id="serviceTypeInput"
                type="text"
                autoComplete="off"
                value={serviceType}
                onFocus={() => setServiceDropdownOpen(true)}
                onChange={(e) => {
                  setServiceType(e.target.value);
                  setServiceDropdownOpen(true);
                  setFormError(null);
                }}
                placeholder="Select or type service..."
                className="w-full pl-3 pr-8 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15"
              />
              <button
                type="button"
                aria-label="Show service options"
                onClick={() => setServiceDropdownOpen((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {serviceDropdownOpen && filteredServices.length > 0 && (
              <ul
                role="listbox"
                aria-label={`${group} services`}
                className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-xs"
              >
                {filteredServices.map((svc) => (
                  <li key={svc}>
                    <button
                      type="button"
                      onClick={() => {
                        setServiceType(svc);
                        setServiceDropdownOpen(false);
                        setFormError(null);
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors cursor-pointer ${
                        svc === serviceType
                          ? 'bg-emerald-50/70 font-semibold text-[#1f5e4b]'
                          : 'text-slate-800'
                      }`}
                    >
                      {svc}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Group-Specific Dynamic Fields */}
          {groupDef.dynamicFields.length > 0 && (
            <div className="pt-2.5 border-t border-slate-100">
              <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                {groupDef.shortLabel} Fields
              </div>
              <div
                className={`grid gap-2 ${
                  groupDef.dynamicFields.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
                }`}
              >
                {groupDef.dynamicFields.map((field) => (
                  <div key={field.id}>
                    <label
                      htmlFor={field.id}
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      {field.label}
                    </label>
                    <input
                      id={field.id}
                      type={field.type || 'text'}
                      step={field.type === 'number' ? '0.01' : undefined}
                      min={field.type === 'number' ? '0' : undefined}
                      value={dynamicValues[field.id] || ''}
                      onChange={(e) => handleDynamicFieldChange(field.id, e.target.value)}
                      placeholder={field.placeholder}
                      className={`w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15 ${
                        field.type === 'number' ? 'font-mono tabular-nums' : ''
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conditional Fields: AEPS WITHDRAWAL hides Payment Mode, Debit & Credit and shows Amount */}
          {isAepsWithdrawal ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="aepsAmountInput"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Amount <span className="text-red-700" aria-hidden="true">*</span>
                </label>
                <input
                  ref={amountInputRef}
                  id="aepsAmountInput"
                  type="text"
                  inputMode="decimal"
                  required
                  value={aepsAmount}
                  onChange={(e) => {
                    setAepsAmount(sanitizeDecimalInput(e.target.value));
                    setFormError(null);
                  }}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15"
                />
              </div>
              <div>
                <label
                  htmlFor="remarksInput"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Remarks / Party
                </label>
                <input
                  id="remarksInput"
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Shafeek"
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15"
                />
              </div>
            </div>
          ) : (
            <>
              {/* Payment Mode + Remarks */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="paymentModeSelect"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Payment Mode
                  </label>
                  <select
                    id="paymentModeSelect"
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15"
                  >
                    <option value="Cash">Cash</option>
                    <option value="ONLINE">ONLINE</option>
                    <option value="CREDIT">CREDIT</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="remarksInput"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Remarks / Party
                  </label>
                  <input
                    id="remarksInput"
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="e.g. Shafeek"
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15"
                  />
                </div>
              </div>

              {/* Debit & Credit */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="debitInput"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Debit (Out / Dr)
                  </label>
                  <input
                    id="debitInput"
                    type="number"
                    step="0.01"
                    min="0"
                    value={debit}
                    onChange={(e) => {
                      setDebit(e.target.value);
                      setFormError(null);
                    }}
                    placeholder="0.00"
                    className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-200 rounded-lg bg-white text-red-700 placeholder:text-slate-400 focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15"
                  />
                </div>
                <div>
                  <label
                    htmlFor="creditInput"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Credit (In / Cr)
                  </label>
                  <input
                    id="creditInput"
                    type="number"
                    step="0.01"
                    min="0"
                    value={credit}
                    onChange={(e) => {
                      setCredit(e.target.value);
                      setFormError(null);
                    }}
                    placeholder="0.00"
                    className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-200 rounded-lg bg-white text-emerald-700 placeholder:text-slate-400 focus:outline-none focus:border-[#1f5e4b] focus:ring-2 focus:ring-[#1f5e4b]/15"
                  />
                </div>
              </div>
            </>
          )}

          {/* Live Account Impact Preview */}
          <div className="pt-2.5 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-medium text-slate-700">Account Impact Preview</span>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={overrideDeltas}
                  onChange={(e) => handleToggleOverride(e.target.checked)}
                  className="rounded border-slate-300 text-[#1f5e4b] focus:ring-[#1f5e4b]"
                />
                <span>Custom deltas</span>
              </label>
            </div>

            <p
              data-testid="impact-preview-text"
              className="text-[11px] font-mono tabular-nums text-slate-600 leading-relaxed"
            >
              {impactParts.length > 0
                ? impactParts.join('  ·  ')
                : 'Enter a Debit or Credit amount to preview balance changes.'}
            </p>

            {overrideDeltas && (
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {deltaInputs.map((d) => (
                  <div key={d.key}>
                    <label
                      htmlFor={`custom-delta-${d.key}`}
                      className="block text-[11px] text-slate-500 mb-0.5"
                    >
                      {d.label}
                    </label>
                    <input
                      id={`custom-delta-${d.key}`}
                      type="number"
                      step="0.01"
                      value={customDeltasText[d.key]}
                      onChange={(e) =>
                        setCustomDeltasText((prev) => ({
                          ...prev,
                          [d.key]: e.target.value,
                        }))
                      }
                      className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:border-[#1f5e4b]"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {formError && (
            <p
              role="alert"
              className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
            >
              {formError}
            </p>
          )}

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5e4b]"
          >
            {editingEntry ? (
              <>
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>Save Entry Changes</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add Entry to Canvas</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Saved Dates Footer */}
      <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-600">Days with Entries</span>
          <button
            type="button"
            onClick={onRequestResetAll}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Reset All</span>
          </button>
        </div>

        {savedDates.length === 0 ? (
          <p className="text-xs text-slate-500">No logged dates stored yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {savedDates.map(({ date, count }) => {
              const isCurrent = date === selectedDate;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onSelectDate(date)}
                  className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded-md border transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {formatExcelDate(date)} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
