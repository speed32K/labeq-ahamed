import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, CheckCircle2, Copy, MessageSquare, Phone, Send, User, X } from 'lucide-react';
import type { BusinessGroupName, LogEntry } from '../types/ledger';
import { formatNum, round2, sanitizeDecimalInput } from '../utils/accounting';
import {
  buildCreditNotificationPayload,
  buildSmsHref,
  BUSINESS_SMS_BRAND,
  formatSmsAmount,
  lookupCustomerPreviousDue,
  validateCreditPopupInput,
  type CreditNotificationPayload,
} from '../utils/creditSms';

export interface PendingCreditDraft {
  group: BusinessGroupName;
  serviceType: string;
  entryDate: string;
  initialCustomerName: string;
  initialMobileNumber: string;
  initialAmount: number;
}

interface CreditNotificationModalProps {
  draft: PendingCreditDraft | null;
  entriesByDate: Record<string, LogEntry[]>;
  onClose: () => void;
  onConfirmSave: (payload: CreditNotificationPayload) => { ok: boolean; error?: string };
}

export function CreditNotificationModal({
  draft,
  entriesByDate,
  onClose,
  onConfirmSave,
}: CreditNotificationModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [amountText, setAmountText] = useState('');
  const [previousDueText, setPreviousDueText] = useState('0');
  const [manualDueCustomerKey, setManualDueCustomerKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedPayload, setSavedPayload] = useState<CreditNotificationPayload | null>(null);

  useEffect(() => {
    if (!draft) return;
    setCustomerName(draft.initialCustomerName);
    setMobileNumber(draft.initialMobileNumber);
    setAmountText(draft.initialAmount > 0 ? String(draft.initialAmount) : '');
    setManualDueCustomerKey(null);
    setError(null);
    setCopied(false);
    setSavedPayload(null);
  }, [draft]);

  useEffect(() => {
    if (!draft) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [draft, onClose]);

  const customerLookupKey = `${customerName.trim().toLowerCase()}|${mobileNumber.replace(/\D/g, '')}`;

  const detectedDue = useMemo(
    () => lookupCustomerPreviousDue(entriesByDate, customerName, mobileNumber),
    [entriesByDate, customerName, mobileNumber]
  );

  // Automatically update Previous Due whenever the operator enters a customer with prior dues,
  // unless they explicitly edited Previous Due for this exact customer.
  useEffect(() => {
    if (!draft || savedPayload) return;
    if (manualDueCustomerKey === customerLookupKey) return;
    setPreviousDueText(detectedDue.previousDue > 0 ? String(detectedDue.previousDue) : '0');
  }, [draft, savedPayload, detectedDue.previousDue, customerLookupKey, manualDueCustomerKey]);

  const parsedAmount = round2(parseFloat(amountText) || 0);
  const parsedPreviousDue = round2(parseFloat(previousDueText) || 0);

  const previewPayload = useMemo(
    () =>
      buildCreditNotificationPayload({
        customerName: customerName || 'Customer',
        mobileNumber,
        amount: parsedAmount,
        entryDate: draft?.entryDate || '',
        previousDue: parsedPreviousDue,
      }),
    [customerName, mobileNumber, parsedAmount, draft?.entryDate, parsedPreviousDue]
  );

  if (!draft) return null;

  const activePayload = savedPayload ?? previewPayload;
  const smsHref = buildSmsHref(activePayload.popup_data.mobile_number, activePayload.customer_sms);

  const handleCopySms = async () => {
    try {
      await navigator.clipboard.writeText(activePayload.customer_sms);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically. Select the SMS text manually.');
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const validation = validateCreditPopupInput({
      customerName,
      mobileNumber,
      amount: parsedAmount,
      previousDue: parsedPreviousDue,
    });
    if (!validation.valid) {
      setError(validation.error || 'Please check the customer credit details.');
      return;
    }

    const payload = buildCreditNotificationPayload({
      customerName: validation.normalizedName!,
      mobileNumber: validation.normalizedMobile!,
      amount: validation.normalizedAmount!,
      entryDate: draft.entryDate,
      previousDue: validation.normalizedPreviousDue ?? 0,
    });

    const saveResult = onConfirmSave(payload);
    if (!saveResult.ok) {
      setError(saveResult.error || 'Could not record the credit transaction.');
      return;
    }

    setError(null);
    setSavedPayload(payload);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-notification-modal-title"
      data-testid="credit-notification-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="credit-notification-modal-title"
              className="text-base font-semibold text-slate-900 truncate"
            >
              {savedPayload ? 'Credit Recorded · Customer SMS Ready' : 'Not Paid (Credit) Confirmation'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {draft.group} · {draft.serviceType}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close credit confirmation dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {savedPayload ? (
          <div className="p-5 space-y-4" data-testid="credit-saved-panel">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#1f5e4b] mt-0.5 shrink-0" aria-hidden="true" />
              <div className="text-xs text-emerald-950 space-y-0.5">
                <p className="font-semibold">
                  ₹{formatNum(savedPayload.popup_data.amount)} added to Not Paid (Credit)
                </p>
                <p className="text-emerald-800">
                  {savedPayload.popup_data.customer_name} ·{' '}
                  <span className="font-mono">{savedPayload.popup_data.mobile_number}</span>
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#1f5e4b]" aria-hidden="true" />
                  <span>Customer SMS ({BUSINESS_SMS_BRAND})</span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopySms()}
                  data-testid="copy-credit-sms-btn"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1f5e4b] hover:text-[#17483a] cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" aria-hidden="true" />
                      <span>Copy SMS</span>
                    </>
                  )}
                </button>
              </div>
              <p
                data-testid="credit-sms-final"
                className="text-xs text-slate-800 leading-relaxed whitespace-pre-line bg-white border border-slate-200 rounded-md px-3 py-2.5"
              >
                {savedPayload.customer_sms}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                data-testid="credit-done-btn"
                className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Done
              </button>
              <a
                href={smsHref}
                data-testid="open-sms-app-link"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Send SMS</span>
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="creditCustomerName"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Customer Name <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <User
                    className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="creditCustomerName"
                    data-testid="credit-customer-name"
                    type="text"
                    autoFocus
                    maxLength={80}
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. Rahul Kumar"
                    className="w-full h-9 pl-8 pr-3 text-sm text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1f5e4b]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="creditMobileNumber"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Customer Mobile Number <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <Phone
                    className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="creditMobileNumber"
                    data-testid="credit-mobile-number"
                    type="tel"
                    inputMode="tel"
                    maxLength={20}
                    value={mobileNumber}
                    onChange={(e) => {
                      setMobileNumber(e.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. 9876543210"
                    className="w-full h-9 pl-8 pr-3 text-sm font-mono text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1f5e4b]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="creditAmountInput"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Credit Amount <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="creditAmountInput"
                    data-testid="credit-amount-input"
                    type="text"
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => {
                      setAmountText(sanitizeDecimalInput(e.target.value));
                      setError(null);
                    }}
                    placeholder="0.00"
                    className="w-full h-9 px-3 text-sm font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1f5e4b]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="creditPreviousDueInput"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Previous Due <span className="text-slate-400 font-normal">(0 if none)</span>
                  </label>
                  <input
                    id="creditPreviousDueInput"
                    data-testid="credit-previous-due-input"
                    type="text"
                    inputMode="decimal"
                    value={previousDueText}
                    onChange={(e) => {
                      setPreviousDueText(sanitizeDecimalInput(e.target.value));
                      setManualDueCustomerKey(customerLookupKey);
                      setError(null);
                    }}
                    placeholder="0"
                    className="w-full h-9 px-3 text-sm font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1f5e4b]"
                  />
                </div>
              </div>

              {detectedDue.previousDue > 0 && (
                <div
                  data-testid="detected-previous-due-badge"
                  className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2"
                >
                  <span>
                    Existing due found for this customer:{' '}
                    <strong className="font-mono">
                      Rs -{formatSmsAmount(detectedDue.previousDue)}
                    </strong>{' '}
                    ({detectedDue.matchedEntriesCount}{' '}
                    {detectedDue.matchedEntriesCount === 1 ? 'previous entry' : 'previous entries'})
                  </span>
                </div>
              )}
            </div>

            {/* Live SMS Preview */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#1f5e4b]" aria-hidden="true" />
                  <span>Customer SMS Preview</span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopySms()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1f5e4b] hover:text-[#17483a] cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <p
                data-testid="credit-sms-preview"
                className="text-xs text-slate-700 leading-relaxed whitespace-pre-line bg-white border border-slate-200 rounded-md px-3 py-2"
              >
                {previewPayload.customer_sms}
              </p>
            </div>

            {error && (
              <p
                role="alert"
                className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
              >
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="confirm-credit-save-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] rounded-lg transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Confirm &amp; Save Credit</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
