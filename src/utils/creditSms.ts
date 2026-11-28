import type { LogEntry } from '../types/ledger';
import { computeAutoDeltas, getEntryAmount, round2 } from './accounting';

export const BUSINESS_SMS_BRAND = 'AMD SOLUTIONS';

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface CreditPopupData {
  customer_name: string;
  mobile_number: string;
  amount: number;
  entry_date: string;
  previous_due: number;
  total_dues: number;
}

export interface CreditNotificationPayload {
  popup_data: CreditPopupData;
  customer_sms: string;
}

export interface CreditValidationResult {
  valid: boolean;
  error?: string;
  normalizedMobile?: string;
  normalizedName?: string;
  normalizedAmount?: number;
  normalizedPreviousDue?: number;
}

/**
 * Strips whitespace, dashes, and parentheses while preserving an optional leading '+'.
 */
export function sanitizeMobileNumber(raw: string): string {
  const trimmed = (raw || '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus && digits.length > 0 ? `+${digits}` : digits;
}

/**
 * Formats an ISO date string (YYYY-MM-DD) as "DD MMM" (e.g. "28 Nov") deterministically.
 */
export function formatSmsDayMonth(dateISO: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateISO || '').trim());
  if (match) {
    const monthIdx = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (monthIdx >= 0 && monthIdx < 12 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${SHORT_MONTHS[monthIdx]}`;
    }
  }
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')} ${SHORT_MONTHS[now.getMonth()]}`;
}

/**
 * Formats positive currency amounts cleanly for billing SMS (omits .00 for whole numbers).
 */
export function formatSmsAmount(value: number): string {
  const abs = round2(Math.abs(Number.isFinite(value) ? value : 0));
  const hasFraction = Math.abs(abs - Math.round(abs)) > 0.0001;
  return abs.toLocaleString('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function validateCreditPopupInput(input: {
  customerName: string;
  mobileNumber: string;
  amount: number;
  previousDue?: number;
}): CreditValidationResult {
  const normalizedName = (input.customerName || '').trim();
  if (normalizedName.length < 1) {
    return { valid: false, error: 'Please enter the customer name.' };
  }
  if (normalizedName.length > 80) {
    return { valid: false, error: 'Customer name must be 80 characters or fewer.' };
  }

  const normalizedMobile = sanitizeMobileNumber(input.mobileNumber);
  const digitCount = normalizedMobile.replace(/\D/g, '').length;
  if (digitCount < 10 || digitCount > 15) {
    return {
      valid: false,
      error: 'Enter a valid mobile number (10 to 15 digits).',
    };
  }

  const normalizedAmount = round2(Number.isFinite(input.amount) ? input.amount : 0);
  if (normalizedAmount <= 0) {
    return { valid: false, error: 'Credit amount must be greater than 0.' };
  }

  const rawPrev = input.previousDue ?? 0;
  const normalizedPreviousDue = round2(Number.isFinite(rawPrev) ? rawPrev : 0);
  if (normalizedPreviousDue < 0) {
    return { valid: false, error: 'Previous due cannot be negative.' };
  }

  return {
    valid: true,
    normalizedName,
    normalizedMobile,
    normalizedAmount,
    normalizedPreviousDue,
  };
}

/**
 * Formats TotalDues when adding a new Not Paid (Credit) entry onto an existing unpaid due:
 * Both previous unpaid due (-PreviousDue) and the new credit entry (-CreditAmount) are dues owed,
 * so TotalDues = -(PreviousDue + CreditAmount) (e.g. -13,500 + -8,000 = Rs -21,500).
 */
export function formatTotalDuesLabel(previousDue: number, creditAmount: number): string {
  const prev = round2(Math.max(0, Number.isFinite(previousDue) ? previousDue : 0));
  const amt = round2(Math.max(0, Number.isFinite(creditAmount) ? creditAmount : 0));
  const combinedDue = round2(prev + amt);
  if (combinedDue === 0) {
    return 'Rs 0 (Account Clear ✅)';
  }
  return `Rs -${formatSmsAmount(combinedDue)}`;
}

/**
 * Generates the exact AMD SOLUTIONS billing SMS for credit entries:
 * - No previous due (previousDue <= 0):
 *     Hi [CustomerName], Entry added for Rs -[CreditAmount]
 *     on [DD MMM]. Total dues : Rs -[CreditAmount].
 *
 *     Thank you
 *     AMD SOLUTIONS
 *
 * - Previous due exists (previousDue > 0):
 *     Previous due is Rs -[PreviousDue], new entry is Rs -[CreditAmount],
 *     so TotalDues = -(PreviousDue + CreditAmount) → Rs -[PreviousDue + CreditAmount]
 */
export function formatCreditSmsMessage(params: {
  customerName: string;
  amount: number;
  entryDate: string;
  previousDue?: number;
}): string {
  const safeName = (params.customerName || '').trim() || 'Customer';
  const creditAmount = round2(Math.max(0, Number.isFinite(params.amount) ? params.amount : 0));
  const previousDue = round2(
    Math.max(0, Number.isFinite(params.previousDue ?? 0) ? (params.previousDue ?? 0) : 0)
  );
  const formattedDate = formatSmsDayMonth(params.entryDate);
  const formattedCredit = formatSmsAmount(creditAmount);

  if (previousDue <= 0) {
    return [
      `Hi ${safeName}, Entry added for Rs -${formattedCredit}`,
      `on ${formattedDate}. Total dues : Rs -${formattedCredit}.`,
      '',
      'Thank you',
      BUSINESS_SMS_BRAND,
    ].join('\n');
  }

  const formattedPrevious = formatSmsAmount(previousDue);
  const formattedTotalDues = formatTotalDuesLabel(previousDue, creditAmount);

  return [
    `Hi ${safeName}, Entry added for Rs -${formattedCredit}`,
    `on ${formattedDate}. Previous dues : Rs -${formattedPrevious}.`,
    `Total dues : ${formattedTotalDues}.`,
    '',
    'Thank you',
    BUSINESS_SMS_BRAND,
  ].join('\n');
}

export function buildCreditNotificationPayload(params: {
  customerName: string;
  mobileNumber: string;
  amount: number;
  entryDate: string;
  previousDue?: number;
}): CreditNotificationPayload {
  const customer_name = (params.customerName || '').trim();
  const mobile_number = sanitizeMobileNumber(params.mobileNumber);
  const amount = round2(Math.max(0, Number.isFinite(params.amount) ? params.amount : 0));
  const previous_due = round2(
    Math.max(0, Number.isFinite(params.previousDue ?? 0) ? (params.previousDue ?? 0) : 0)
  );
  const total_dues = round2(-(previous_due + amount));

  return {
    popup_data: {
      customer_name,
      mobile_number,
      amount,
      entry_date: params.entryDate,
      previous_due,
      total_dues,
    },
    customer_sms: formatCreditSmsMessage({
      customerName: customer_name,
      amount,
      entryDate: params.entryDate,
      previousDue: previous_due,
    }),
  };
}

export function buildSmsHref(mobileNumber: string, message: string): string {
  const cleanMobile = sanitizeMobileNumber(mobileNumber);
  return `sms:${encodeURIComponent(cleanMobile)}?body=${encodeURIComponent(message)}`;
}

/**
 * Merges customer name and mobile number into the ledger entry's remarks without
 * duplicating existing text and staying within the 300-char Firestore blueprint limit.
 */
export function mergeCustomerDetailsIntoRemarks(
  existingRemarks: string,
  customerName: string,
  mobileNumber: string
): string {
  const base = (existingRemarks || '').trim();
  const cleanName = (customerName || '').trim();
  const cleanMobile = sanitizeMobileNumber(mobileNumber);

  const parts: string[] = [];
  if (cleanName && !base.toLowerCase().includes(cleanName.toLowerCase())) {
    parts.push(cleanName);
  }
  if (cleanMobile && !base.includes(cleanMobile)) {
    parts.push(cleanMobile);
  }

  const combined = base
    ? parts.length > 0
      ? `${base} · ${parts.join(' · ')}`
      : base
    : parts.join(' · ');

  return combined.slice(0, 300);
}

export interface CustomerDueHistoryItem {
  id: string;
  date: string;
  type: string;
  serviceType: string;
  remarks: string;
  paymentMode: string;
  amount: number;
  runningDue: number;
}

export interface CustomerPreviousDueResult {
  previousDue: number;
  matchedEntriesCount: number;
  matchedBy: 'mobile' | 'name' | null;
  matchedDates: string[];
  matchedCustomerName: string;
  matchedMobileNumber: string;
  matchedEntries: CustomerDueHistoryItem[];
}

const PHONE_CANDIDATE_REGEX = /\+?\d[\d\s\-()]{8,18}\d/g;

function last10Digits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function extractFirstPhoneNumber(text: string): string {
  const matches = (text || '').match(PHONE_CANDIDATE_REGEX) || [];
  for (const m of matches) {
    const clean = sanitizeMobileNumber(m);
    if (clean.replace(/\D/g, '').length >= 10) {
      return clean;
    }
  }
  return '';
}

function extractPhoneTailSet(text: string): Set<string> {
  const tails = new Set<string>();
  const matches = (text || '').match(PHONE_CANDIDATE_REGEX) || [];
  for (const m of matches) {
    const tail = last10Digits(m);
    if (tail) tails.add(tail);
  }
  return tails;
}

function stripPhoneNumbersFromText(text: string): string {
  return (text || '')
    .replace(PHONE_CANDIDATE_REGEX, ' ')
    .replace(/[·,|/()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCustomerInfoFromRemarks(remarks: string): {
  customerName: string;
  mobileNumber: string;
} {
  const mobileNumber = extractFirstPhoneNumber(remarks);
  const segments = (remarks || '')
    .split(/[·,|/]/)
    .map((part) => part.trim())
    .filter(Boolean);

  // Pick the last non-phone segment (credit entries append "Name · Mobile" at the end)
  const nonPhoneSegments = segments.filter((seg) => !last10Digits(seg) && /[a-zA-Z]/.test(seg));
  const customerName =
    nonPhoneSegments.length > 0
      ? nonPhoneSegments[nonPhoneSegments.length - 1]
      : stripPhoneNumbersFromText(remarks);

  return { customerName, mobileNumber };
}

/**
 * Extracts customer name & mobile query from the EntryComposer inputs (dedicated credit
 * lookup inputs, Remarks / Party, or group-specific dynamic fields like Customer Ref / Mobile No).
 */
export function extractCustomerQueryFromComposer(inputs: {
  creditCustomerName?: string;
  creditMobileNumber?: string;
  remarks?: string;
  dynamicValues?: Record<string, string>;
}): { customerName: string; mobileNumber: string } {
  const dyn = inputs.dynamicValues || {};
  const explicitName = (inputs.creditCustomerName || '').trim();
  const explicitMobile = (inputs.creditMobileNumber || '').trim();
  const remarks = (inputs.remarks || '').trim();
  const dynCustomerRef = (
    dyn.dynCustomerRef ||
    dyn.dynRef ||
    dyn.dynCustomer ||
    dyn.dynParty ||
    ''
  ).trim();
  const dynMobile = (dyn.dynMobileNo || dyn.dynMobile || dyn.dynPhone || '').trim();

  const mobileNumber =
    sanitizeMobileNumber(explicitMobile) ||
    sanitizeMobileNumber(dynMobile) ||
    extractFirstPhoneNumber(remarks) ||
    extractFirstPhoneNumber(dynCustomerRef);

  const remarksName = stripPhoneNumbersFromText(remarks);
  const refName = stripPhoneNumbersFromText(dynCustomerRef);
  const customerName = explicitName || remarksName || refName;

  return { customerName, mobileNumber };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function remarksMatchesCustomerName(remarks: string, normalizedName: string): boolean {
  if (!remarks || normalizedName.length < 2) return false;
  const segments = remarks
    .split(/[·,|/()]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (segments.some((seg) => seg === normalizedName)) {
    return true;
  }
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedName)}([^a-z0-9]|$)`, 'i');
  return pattern.test(remarks);
}

function computeEntryCreditDueContribution(entry: LogEntry): number {
  const deltas = entry.customDeltas ?? computeAutoDeltas(entry);
  if (deltas.credit !== 0) {
    return round2(deltas.credit);
  }
  if (entry.paymentMode === 'CREDIT') {
    return round2(getEntryAmount(entry));
  }
  return 0;
}

/**
 * Checks all historical ledger entries across every stored date to determine whether
 * the same customer (matched first by 10-digit mobile number, then by customer name)
 * already has an unpaid due balance before recording the new transaction.
 */
export function lookupCustomerPreviousDue(
  entriesByDate: Record<string, LogEntry[]>,
  customerName: string,
  mobileNumber: string,
  excludeEntryId?: string
): CustomerPreviousDueResult {
  const targetMobileTail = last10Digits(mobileNumber);
  const targetName = (customerName || '').trim().toLowerCase();

  if (!targetMobileTail && targetName.length < 2) {
    return {
      previousDue: 0,
      matchedEntriesCount: 0,
      matchedBy: null,
      matchedDates: [],
      matchedCustomerName: '',
      matchedMobileNumber: '',
      matchedEntries: [],
    };
  }

  const allEntries: Array<{ dateKey: string; entry: LogEntry }> = [];
  for (const dateKey of Object.keys(entriesByDate).sort()) {
    const list = entriesByDate[dateKey] || [];
    for (const entry of list) {
      if (excludeEntryId && entry.id === excludeEntryId) continue;
      allEntries.push({ dateKey, entry });
    }
  }

  // Pass 1: exact 10-digit mobile match in remarks
  if (targetMobileTail) {
    let mobileDueSum = 0;
    const matchedDateSet = new Set<string>();
    const matchedEntries: CustomerDueHistoryItem[] = [];
    let matchedCustomerName = '';
    let matchedMobileNumber = '';

    for (const { dateKey, entry } of allEntries) {
      const tails = extractPhoneTailSet(entry.remarks || '');
      if (tails.has(targetMobileTail)) {
        const contribution = computeEntryCreditDueContribution(entry);
        if (contribution !== 0) {
          mobileDueSum = round2(mobileDueSum + contribution);
          const entryDate = entry.date || dateKey;
          matchedDateSet.add(entryDate);
          const info = extractCustomerInfoFromRemarks(entry.remarks || '');
          if (info.customerName) matchedCustomerName = info.customerName;
          if (info.mobileNumber) matchedMobileNumber = info.mobileNumber;
          matchedEntries.push({
            id: entry.id,
            date: entryDate,
            type: entry.type,
            serviceType: entry.serviceType,
            remarks: entry.remarks || '',
            paymentMode: entry.paymentMode,
            amount: contribution,
            runningDue: round2(Math.max(0, mobileDueSum)),
          });
        }
      }
    }
    if (matchedEntries.length > 0) {
      return {
        previousDue: round2(Math.max(0, mobileDueSum)),
        matchedEntriesCount: matchedEntries.length,
        matchedBy: 'mobile',
        matchedDates: Array.from(matchedDateSet).sort(),
        matchedCustomerName,
        matchedMobileNumber,
        matchedEntries,
      };
    }
  }

  // Pass 2: normalized customer name match in remarks
  if (targetName.length >= 2) {
    let nameDueSum = 0;
    const matchedDateSet = new Set<string>();
    const matchedEntries: CustomerDueHistoryItem[] = [];
    let matchedCustomerName = '';
    let matchedMobileNumber = '';

    for (const { dateKey, entry } of allEntries) {
      if (remarksMatchesCustomerName(entry.remarks || '', targetName)) {
        const contribution = computeEntryCreditDueContribution(entry);
        if (contribution !== 0) {
          nameDueSum = round2(nameDueSum + contribution);
          const entryDate = entry.date || dateKey;
          matchedDateSet.add(entryDate);
          const info = extractCustomerInfoFromRemarks(entry.remarks || '');
          if (info.customerName) matchedCustomerName = info.customerName;
          if (info.mobileNumber) matchedMobileNumber = info.mobileNumber;
          matchedEntries.push({
            id: entry.id,
            date: entryDate,
            type: entry.type,
            serviceType: entry.serviceType,
            remarks: entry.remarks || '',
            paymentMode: entry.paymentMode,
            amount: contribution,
            runningDue: round2(Math.max(0, nameDueSum)),
          });
        }
      }
    }
    if (matchedEntries.length > 0) {
      return {
        previousDue: round2(Math.max(0, nameDueSum)),
        matchedEntriesCount: matchedEntries.length,
        matchedBy: 'name',
        matchedDates: Array.from(matchedDateSet).sort(),
        matchedCustomerName,
        matchedMobileNumber,
        matchedEntries,
      };
    }
  }

  return {
    previousDue: 0,
    matchedEntriesCount: 0,
    matchedBy: null,
    matchedDates: [],
    matchedCustomerName: '',
    matchedMobileNumber: '',
    matchedEntries: [],
  };
}


