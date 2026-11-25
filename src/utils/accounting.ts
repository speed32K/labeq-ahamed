import type {
  AppState,
  BalanceSnapshot,
  ComputedLedgerRow,
  DayLedgerResult,
  LogEntry,
  RunningBalances,
} from '../types/ledger';

export function emptyBalances(): BalanceSnapshot {
  return {
    ko: 0,
    cash: 0,
    fino: 0,
    airtel: 0,
    bank: 0,
    credit: 0,
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sumBalances(b: BalanceSnapshot): number {
  return round2(b.ko + b.cash + b.fino + b.airtel + b.bank + b.credit);
}

export function toRunningBalances(b: BalanceSnapshot): RunningBalances {
  return {
    ...b,
    total: sumBalances(b),
  };
}

export interface AutoDeltaInput {
  type: string;
  serviceType: string;
  paymentMode: string;
  debit: number;
  credit: number;
}

/**
 * Returns true for any withdrawal transaction (AEPS Withdrawal, ATM Withdrawal, Self Withdrawal, etc.).
 */
export function isWithdrawalService(serviceType: string): boolean {
  return /\bWITHDRAW(?:AL|S)?\b/i.test((serviceType || '').trim());
}

/**
 * Maps a business group to its primary wallet/balance account key and display label.
 */
export function getGroupBalanceAccount(
  group: string,
  paymentMode = 'Cash'
): { key: keyof BalanceSnapshot; label: string } {
  const normalized = (group || '').trim().toUpperCase();
  const isOnline = (paymentMode || 'Cash').trim().toUpperCase() === 'ONLINE';

  if (normalized === 'SBI CSP') return { key: 'ko', label: 'KO Limit' };
  if (normalized === 'AIRTEL CSP' || normalized === 'AIRTEL') {
    return { key: 'airtel', label: 'Airtel Limit' };
  }
  if (normalized === 'FINO') return { key: 'fino', label: 'Fino Limit' };
  if (isOnline) return { key: 'bank', label: 'Cash In Bank' };
  return { key: 'cash', label: 'Cash In Hand' };
}

export interface WithdrawalReductionCalculation {
  isWithdrawal: boolean;
  accountKey: keyof BalanceSnapshot;
  accountLabel: string;
  reductionAmount: number;
  deltas: BalanceSnapshot;
}

/**
 * Calculates the wallet balance reduction delta for an AEPS Withdrawal or similar withdrawal service.
 */
export function calculateWithdrawalReduction(
  group: string,
  serviceType: string,
  amount: number,
  paymentMode = 'Cash'
): WithdrawalReductionCalculation {
  const { key, label } = getGroupBalanceAccount(group, paymentMode);
  const deltas = emptyBalances();
  const withdrawal = isWithdrawalService(serviceType);
  const amt = round2(amount || 0);

  if (withdrawal && amt > 0) {
    deltas[key] = round2(-amt);
    return {
      isWithdrawal: true,
      accountKey: key,
      accountLabel: label,
      reductionAmount: amt,
      deltas,
    };
  }

  return {
    isWithdrawal: withdrawal,
    accountKey: key,
    accountLabel: label,
    reductionAmount: 0,
    deltas,
  };
}

export interface WithdrawalValidationResult {
  valid: boolean;
  accountKey: keyof BalanceSnapshot;
  accountLabel: string;
  availableBalance: number;
  resultingBalance: number;
  error?: string;
}

/**
 * Validates that the selected group has sufficient balance before deducting a withdrawal amount.
 */
export function validateWithdrawalBalance(
  currentBalances: BalanceSnapshot,
  group: string,
  serviceType: string,
  amount: number,
  paymentMode = 'Cash'
): WithdrawalValidationResult {
  const { key, label } = getGroupBalanceAccount(group, paymentMode);
  const available = round2(currentBalances[key] || 0);
  const amt = round2(amount || 0);

  if (!isWithdrawalService(serviceType)) {
    return {
      valid: true,
      accountKey: key,
      accountLabel: label,
      availableBalance: available,
      resultingBalance: available,
    };
  }

  if (amt <= 0) {
    return {
      valid: false,
      accountKey: key,
      accountLabel: label,
      availableBalance: available,
      resultingBalance: available,
      error: 'Withdrawal amount must be greater than 0.',
    };
  }

  const resulting = round2(available - amt);
  if (resulting < 0) {
    return {
      valid: false,
      accountKey: key,
      accountLabel: label,
      availableBalance: available,
      resultingBalance: resulting,
      error: `Insufficient ${label} balance for ${group}: available ${formatNum(available)} INR, requested ${formatNum(amt)} INR.`,
    };
  }

  return {
    valid: true,
    accountKey: key,
    accountLabel: label,
    availableBalance: available,
    resultingBalance: resulting,
  };
}

export interface WalletReductionSummary {
  applied: boolean;
  accountKey: keyof BalanceSnapshot;
  accountLabel: string;
  amount: number;
  previousBalance: number;
  resultingBalance: number;
}

export type AtomicLedgerUpdateResult =
  | {
      ok: true;
      state: AppState;
      entry: LogEntry;
      ledger: DayLedgerResult;
      appliedDeltas: BalanceSnapshot;
      walletReduction: WalletReductionSummary | null;
    }
  | {
      ok: false;
      state: AppState;
      error: string;
      accountKey?: keyof BalanceSnapshot;
      accountLabel?: string;
      availableBalance?: number;
    };

/**
 * Atomically calculates, validates, and applies a ledger entry update—including automatic
 * wallet balance reductions (KO Limit, Airtel Limit, Fino Limit, Cash/Bank) for AEPS
 * withdrawals and similar withdrawal services. Leaves the input state untouched on failure.
 */
export function applyEntryToLedgerAtomically(
  state: AppState,
  payload: Omit<LogEntry, 'id'> & { id?: string }
): AtomicLedgerUpdateResult {
  const dateISO = payload.date;
  const existingDayEntries = state.entriesByDate[dateISO] || [];
  const currentLedger = computeDayLedger(state, dateISO);

  // Compute available wallet balances against the freshest state; when editing an existing
  // entry, temporarily restore that entry's prior deltas so validation is exact.
  const availableBalances: BalanceSnapshot = {
    ko: currentLedger.closing.ko,
    cash: currentLedger.closing.cash,
    fino: currentLedger.closing.fino,
    airtel: currentLedger.closing.airtel,
    bank: currentLedger.closing.bank,
    credit: currentLedger.closing.credit,
  };

  if (payload.id) {
    const previousRow = currentLedger.rows.find((row) => row.id === payload.id);
    if (previousRow) {
      availableBalances.ko = round2(availableBalances.ko - previousRow.deltas.ko);
      availableBalances.cash = round2(availableBalances.cash - previousRow.deltas.cash);
      availableBalances.fino = round2(availableBalances.fino - previousRow.deltas.fino);
      availableBalances.airtel = round2(availableBalances.airtel - previousRow.deltas.airtel);
      availableBalances.bank = round2(availableBalances.bank - previousRow.deltas.bank);
      availableBalances.credit = round2(availableBalances.credit - previousRow.deltas.credit);
    }
  }

  let walletReduction: WalletReductionSummary | null = null;
  let appliedDeltas: BalanceSnapshot;

  if (!payload.customDeltas && isWithdrawalService(payload.serviceType)) {
    const withdrawalAmt = round2(payload.debit > 0 ? payload.debit : payload.credit);
    const validation = validateWithdrawalBalance(
      availableBalances,
      payload.type,
      payload.serviceType,
      withdrawalAmt,
      payload.paymentMode
    );

    if (!validation.valid) {
      return {
        ok: false,
        state,
        error: validation.error || 'Insufficient wallet balance for withdrawal.',
        accountKey: validation.accountKey,
        accountLabel: validation.accountLabel,
        availableBalance: validation.availableBalance,
      };
    }

    const reduction = calculateWithdrawalReduction(
      payload.type,
      payload.serviceType,
      withdrawalAmt,
      payload.paymentMode
    );
    appliedDeltas = reduction.deltas;
    walletReduction = {
      applied: true,
      accountKey: reduction.accountKey,
      accountLabel: reduction.accountLabel,
      amount: reduction.reductionAmount,
      previousBalance: validation.availableBalance,
      resultingBalance: validation.resultingBalance,
    };
  } else {
    appliedDeltas = payload.customDeltas
      ? { ...emptyBalances(), ...payload.customDeltas }
      : computeAutoDeltas({
          type: payload.type,
          serviceType: payload.serviceType,
          paymentMode: payload.paymentMode,
          debit: payload.debit,
          credit: payload.credit,
        });
  }

  const entry: LogEntry = {
    id: payload.id || `txn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date: dateISO,
    type: payload.type,
    serviceType: payload.serviceType,
    remarks: payload.remarks,
    paymentMode: payload.paymentMode,
    debit: round2(payload.debit || 0),
    credit: round2(payload.credit || 0),
    customDeltas: payload.customDeltas ? { ...emptyBalances(), ...payload.customDeltas } : null,
  };

  const nextDayEntries = payload.id
    ? existingDayEntries.map((item) => (item.id === payload.id ? entry : item))
    : [...existingDayEntries, entry];

  const nextState: AppState = {
    ...state,
    initialized: true,
    entriesByDate: {
      ...state.entriesByDate,
      [dateISO]: nextDayEntries,
    },
  };

  const nextLedger = computeDayLedger(nextState, dateISO);

  return {
    ok: true,
    state: nextState,
    entry,
    ledger: nextLedger,
    appliedDeltas,
    walletReduction,
  };
}

/**
 * Computes account balance deltas mirroring OLDTRN rules, with withdrawals deducting
 * directly from the selected group's wallet/account balance.
 */
export function computeAutoDeltas({
  type,
  serviceType,
  paymentMode,
  debit,
  credit,
}: AutoDeltaInput): BalanceSnapshot {
  const d = round2(debit || 0);
  const c = round2(credit || 0);
  const svc = (serviceType || '').trim().toUpperCase();
  const mode = (paymentMode || 'Cash').trim().toUpperCase();
  const isOnline = mode === 'ONLINE';

  const deltas = emptyBalances();

  // Unified Withdrawal Rule:
  // AEPS Withdrawal and any other withdrawal deducts the transaction amount from the selected group's balance.
  if (isWithdrawalService(svc)) {
    const withdrawalAmt = d > 0 ? d : c;
    return calculateWithdrawalReduction(type, svc, withdrawalAmt, paymentMode).deltas;
  }

  // 1. SBI CSP (non-withdrawal services)
  if (type === 'SBI CSP') {
    if (svc.includes('DEPOSIT TO KO LIMIT')) {
      deltas.ko = round2(c - d);
      return deltas;
    }
    if (svc.includes('CSP LIMIT DEPOSIT')) {
      if (d > 0) {
        deltas.ko = d;
        if (isOnline) deltas.bank = -d;
        else deltas.cash = -d;
      } else if (c > 0) {
        deltas.ko = -c;
        if (isOnline) deltas.bank = c;
        else deltas.cash = c;
      }
      return deltas;
    }
    if (svc === 'CASH RECEIVED' || svc === 'DEDECT BY MANIPAL') {
      deltas.ko = round2(d - c);
      return deltas;
    }

    // Standard SBI CSP non-withdrawal deposits/transfers
    if (d > 0) {
      deltas.ko = round2(deltas.ko - d);
      if (isOnline) deltas.bank = round2(deltas.bank - d);
      else deltas.cash = round2(deltas.cash - d);
    }
    if (c > 0) {
      deltas.ko = round2(deltas.ko - c);
      if (isOnline) deltas.bank = round2(deltas.bank + c);
      else deltas.cash = round2(deltas.cash + c);
    }
    return deltas;
  }

  // 2. AIRTEL CSP / AIRTEL
  if (type === 'AIRTEL CSP' || type === 'AIRTEL') {
    if (svc.includes('MOBILE RECHARGE') || svc.includes('ELECTRICITY BILL')) {
      deltas.airtel = round2(-d);
      if (isOnline) deltas.bank = round2(c);
      else deltas.cash = round2(c);
    } else if (svc.includes('COMMISION') || svc.includes('COMMISSION')) {
      if (isOnline) deltas.airtel = round2(c);
      else deltas.cash = round2(c);
    } else if (svc.includes('SERVICE CHARGE')) {
      if (isOnline) deltas.bank = round2(c);
      else deltas.cash = round2(c);
    } else if (svc.includes('MONEY TRANSFER') || svc.includes('INITIAL DEPOSIT')) {
      deltas.airtel = round2(-c);
      if (isOnline) deltas.bank = round2(c);
      else deltas.cash = round2(c);
    } else if (svc.includes('CSP LIMIT DEPOSIT')) {
      deltas.airtel = round2(c);
    } else {
      deltas.airtel = round2(d - c);
      if (isOnline) deltas.bank = round2(c - d);
      else deltas.cash = round2(c - d);
    }
    return deltas;
  }

  // 3. FINO (legacy support)
  if (type === 'FINO') {
    if (svc.includes('COMMISSION')) {
      deltas.fino = round2(d + c);
    } else if (svc.includes('FINO TO CASH')) {
      deltas.fino = round2(-c);
      deltas.bank = round2(c);
    } else {
      deltas.fino = round2(c - d);
    }
    return deltas;
  }

  // 4. INSTANTPAY
  if (type === 'INSTANTPAY') {
    if (isOnline) deltas.bank = round2(c - d);
    else deltas.cash = round2(c - d);
    return deltas;
  }

  // 5. SHOP / Kerala House / Tehrik e Jadeed / EXPENSE
  if (svc.includes('BANK TO CH TRANSFER')) {
    const amt = c > 0 ? c : d;
    deltas.cash = round2(amt);
    deltas.bank = round2(-amt);
    return deltas;
  }
  if (svc.includes('CASH TO BANK TRANSFER')) {
    const amt = d > 0 ? d : c;
    deltas.cash = round2(-amt);
    deltas.bank = round2(amt);
    return deltas;
  }
  if (svc.includes('DEPOSIT TO KO LIMIT')) {
    const amt = d > 0 ? d : c;
    deltas.ko = round2(amt);
    deltas.cash = round2(-amt);
    return deltas;
  }
  if (svc.includes('DEDECT BY MANIPAL') || svc.includes('MANIPAL KO REDUCTION')) {
    deltas.ko = round2(-d);
    return deltas;
  }
  if (svc === 'MONEY TRANSFER' && isOnline && d > 0) {
    deltas.cash = round2(-d);
    deltas.bank = round2(d);
    return deltas;
  }

  // Standard Cash vs ONLINE vs CREDIT impact
  const net = round2(c - d);
  if (isOnline) {
    deltas.bank = net;
  } else if (mode === 'CREDIT') {
    deltas.credit = net;
  } else {
    deltas.cash = net;
  }
  return deltas;
}

export function getSortedDates(state: AppState): string[] {
  return Object.keys(state.entriesByDate)
    .filter((d) => (state.entriesByDate[d]?.length ?? 0) > 0)
    .sort();
}

export function getOpeningBalancesForDate(
  state: AppState,
  dateISO: string
): { balances: BalanceSnapshot; isManual: boolean; sourceDate: string | null } {
  if (state.openingOverrides[dateISO]) {
    return {
      balances: { ...emptyBalances(), ...state.openingOverrides[dateISO] },
      isManual: true,
      sourceDate: null,
    };
  }

  const allPriorDates = Array.from(
    new Set([
      ...Object.keys(state.entriesByDate).filter((d) => (state.entriesByDate[d]?.length ?? 0) > 0),
      ...Object.keys(state.openingOverrides),
    ])
  )
    .filter((d) => d < dateISO)
    .sort();

  if (!allPriorDates.length) {
    return { balances: emptyBalances(), isManual: false, sourceDate: null };
  }

  // Iteratively compute forward from earliest needed date to avoid deep recursion on large ledgers
  let startIdx = allPriorDates.length - 1;
  while (startIdx > 0 && !state.openingOverrides[allPriorDates[startIdx]]) {
    startIdx--;
  }

  let running: BalanceSnapshot = state.openingOverrides[allPriorDates[startIdx]]
    ? { ...emptyBalances(), ...state.openingOverrides[allPriorDates[startIdx]] }
    : emptyBalances();

  for (let i = startIdx; i < allPriorDates.length; i++) {
    const d = allPriorDates[i];
    if (i > startIdx && state.openingOverrides[d]) {
      running = { ...emptyBalances(), ...state.openingOverrides[d] };
    }
    const entries = state.entriesByDate[d] || [];
    for (const entry of entries) {
      const deltas = entry.customDeltas ? entry.customDeltas : computeAutoDeltas(entry);
      running = {
        ko: round2(running.ko + (deltas.ko || 0)),
        cash: round2(running.cash + (deltas.cash || 0)),
        fino: round2(running.fino + (deltas.fino || 0)),
        airtel: round2(running.airtel + (deltas.airtel || 0)),
        bank: round2(running.bank + (deltas.bank || 0)),
        credit: round2(running.credit + (deltas.credit || 0)),
      };
    }
  }

  return {
    balances: running,
    isManual: false,
    sourceDate: allPriorDates[allPriorDates.length - 1],
  };
}

export function computeDayLedger(state: AppState, dateISO: string): DayLedgerResult {
  const { balances: opening, isManual, sourceDate } = getOpeningBalancesForDate(state, dateISO);
  const rawEntries = state.entriesByDate[dateISO] || [];

  let running: BalanceSnapshot = { ...opening };
  const rows: ComputedLedgerRow[] = rawEntries.map((entry, idx) => {
    const deltas = entry.customDeltas ? entry.customDeltas : computeAutoDeltas(entry);

    running = {
      ko: round2(running.ko + (deltas.ko || 0)),
      cash: round2(running.cash + (deltas.cash || 0)),
      fino: round2(running.fino + (deltas.fino || 0)),
      airtel: round2(running.airtel + (deltas.airtel || 0)),
      bank: round2(running.bank + (deltas.bank || 0)),
      credit: round2(running.credit + (deltas.credit || 0)),
    };

    return {
      ...entry,
      seq: idx + 1,
      deltas,
      running: toRunningBalances(running),
    };
  });

  return {
    opening,
    isManual,
    sourceDate,
    closing: toRunningBalances(running),
    rows,
  };
}

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function todayISO(): string {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function shiftISO(dateISO: string, offsetDays: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d + offsetDays);
  return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function formatExcelDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return iso;
  const [y, m, d] = parts;
  return `${m}/${d}/${y}`;
}

export function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatNum(n: number): string {
  return (Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseNumOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '' || v === '-') return null;
  const cleaned = String(v).replace(/[,*]/g, '').trim();
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? null : round2(num);
}

/**
 * Parses mixed Excel dates seen in OLDTRN (M/D/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD/MM/YYYY)
 * using chronological context from the preceding row to disambiguate D/M vs M/D.
 */
export function parseExcelMixedDate(
  val: unknown,
  fallbackISO: string,
  serialParser?: (serial: number) => { y: number; m: number; d: number } | null
): string {
  if (typeof val === 'number' && serialParser) {
    const parsed = serialParser(val);
    if (parsed) return toISO(parsed.y, parsed.m, parsed.d);
  }
  const str = String(val ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return fallbackISO;

  const p1 = parseInt(m[1], 10);
  const p2 = parseInt(m[2], 10);
  const yr = parseInt(m[3], 10);

  if (p1 > 12) return toISO(yr, p2, p1);
  if (p2 > 12) return toISO(yr, p1, p2);

  const optMD = toISO(yr, p1, p2);
  const optDM = toISO(yr, p2, p1);

  if (fallbackISO) {
    if (optDM >= fallbackISO && optMD < fallbackISO) return optDM;
    if (optMD >= fallbackISO && optDM < fallbackISO) return optMD;
    // If both are >= fallbackISO, pick the one closer to fallbackISO
    if (optDM >= fallbackISO && optMD >= fallbackISO) {
      return optDM < optMD ? optDM : optMD;
    }
  }
  return optMD;
}

export function describeDeltas(deltas: BalanceSnapshot): string[] {
  const labels: Array<[keyof BalanceSnapshot, string]> = [
    ['ko', 'KO Limit'],
    ['cash', 'Cash In Hand'],
    ['fino', 'Fino Limit'],
    ['airtel', 'Airtel Limit'],
    ['bank', 'Cash In Bank'],
    ['credit', 'Credit'],
  ];

  const parts: string[] = [];
  for (const [key, label] of labels) {
    const val = deltas[key];
    if (Math.abs(val) > 0.0001) {
      const sign = val > 0 ? '+' : '';
      parts.push(`${label} ${sign}${formatNum(val)}`);
    }
  }
  return parts;
}

/**
 * Returns true when the selected service triggers the simplified AEPS Withdrawal layout.
 */
export function isAepsWithdrawalService(serviceType: string): boolean {
  return serviceType.trim().toUpperCase() === 'AEPS WITHDRAWAL';
}

/**
 * Strips non-numeric characters while allowing a single decimal point for currency inputs.
 */
export function sanitizeDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx === -1) return cleaned;
  return cleaned.slice(0, dotIdx + 1) + cleaned.slice(dotIdx + 1).replace(/\./g, '');
}

export type PerformanceChartMode = 'byGroup' | 'byEntry';

export interface DailyPerformancePoint {
  key: string;
  label: string;
  fullLabel: string;
  debit: number;
  credit: number;
  net: number;
  count: number;
}

/**
 * Aggregates ledger rows into Recharts-ready Debit vs Credit and Net performance points.
 * - 'byGroup': aggregates totals per business group for side-by-side comparison.
 * - 'byEntry': plots each transaction chronologically with cumulative daily net flow.
 */
export function buildDailyPerformanceChartData(
  rows: ComputedLedgerRow[],
  mode: PerformanceChartMode = 'byGroup'
): DailyPerformancePoint[] {
  if (mode === 'byEntry') {
    let cumulativeNet = 0;
    return rows.map((row) => {
      const debit = round2(row.debit || 0);
      const credit = round2(row.credit || 0);
      cumulativeNet = round2(cumulativeNet + (credit - debit));
      return {
        key: row.id,
        label: `#${row.seq}`,
        fullLabel: `#${row.seq} · ${row.type} — ${row.serviceType}`,
        debit,
        credit,
        net: cumulativeNet,
        count: 1,
      };
    });
  }

  const map = new Map<string, { debit: number; credit: number; count: number }>();
  for (const row of rows) {
    const prev = map.get(row.type) || { debit: 0, credit: 0, count: 0 };
    map.set(row.type, {
      debit: round2(prev.debit + (row.debit || 0)),
      credit: round2(prev.credit + (row.credit || 0)),
      count: prev.count + 1,
    });
  }

  return Array.from(map.entries()).map(([group, stats]) => ({
    key: group,
    label: group,
    fullLabel: `${group} (${stats.count} ${stats.count === 1 ? 'entry' : 'entries'})`,
    debit: stats.debit,
    credit: stats.credit,
    net: round2(stats.credit - stats.debit),
    count: stats.count,
  }));
}


