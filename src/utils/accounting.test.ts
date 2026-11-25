import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEntryToLedgerAtomically,
  buildDailyPerformanceChartData,
  calculateWithdrawalReduction,
  computeAutoDeltas,
  computeDayLedger,
  getOpeningBalancesForDate,
  parseExcelMixedDate,
  formatExcelDate,
  shiftISO,
  isAepsWithdrawalService,
  isWithdrawalService,
  sanitizeDecimalInput,
  validateWithdrawalBalance,
} from './accounting';
import type { AppState } from '../types/ledger';

test('SBI CSP AEPS withdrawal of 1000 INR reduces KO Limit balance by 1000 INR', () => {
  const deltas = computeAutoDeltas({
    type: 'SBI CSP',
    serviceType: 'AEPS WITHDRAWAL',
    paymentMode: 'Cash',
    debit: 1000,
    credit: 0,
  });
  assert.equal(deltas.ko, -1000);
  assert.equal(deltas.cash, 0);
  assert.equal(deltas.bank, 0);
});

test('Other SBI CSP withdrawals (ATM ONUS/OFFUS) also deduct from KO Limit', () => {
  const atm = computeAutoDeltas({
    type: 'SBI CSP',
    serviceType: 'ATM ONUS WITHDRAWAL',
    paymentMode: 'Cash',
    debit: 2500,
    credit: 0,
  });
  assert.equal(atm.ko, -2500);
  assert.equal(isWithdrawalService('ATM ONUS WITHDRAWAL'), true);
});

test('SBI CSP Money Transfer (ONLINE) reduces KO Limit and increases Cash In Bank', () => {
  const deltas = computeAutoDeltas({
    type: 'SBI CSP',
    serviceType: 'MONEY TRANSFER',
    paymentMode: 'ONLINE',
    debit: 0,
    credit: 10000,
  });
  assert.equal(deltas.ko, -10000);
  assert.equal(deltas.bank, 10000);
  assert.equal(deltas.cash, 0);
});

test('AIRTEL CSP and FINO withdrawals deduct from their respective group balances', () => {
  const airtelAeps = computeAutoDeltas({
    type: 'AIRTEL CSP',
    serviceType: 'AEPS WITHDRAWAL',
    paymentMode: 'Cash',
    debit: 2000,
    credit: 0,
  });
  assert.equal(airtelAeps.airtel, -2000);
  assert.equal(airtelAeps.cash, 0);

  const finoAeps = computeAutoDeltas({
    type: 'FINO',
    serviceType: 'AEPS WITHDRAWAL',
    paymentMode: 'Cash',
    debit: 1200,
    credit: 0,
  });
  assert.equal(finoAeps.fino, -1200);

  const recharge = computeAutoDeltas({
    type: 'AIRTEL CSP',
    serviceType: 'MOBILE RECHARGE',
    paymentMode: 'Cash',
    debit: 299,
    credit: 299,
  });
  assert.equal(recharge.airtel, -299);
  assert.equal(recharge.cash, 299);
});

test('validateWithdrawalBalance blocks overdrafts and allows valid withdrawals', () => {
  const balances = { ko: 5000, cash: 2000, fino: 0, airtel: 1500, bank: 10000, credit: 0 };

  const ok = validateWithdrawalBalance(balances, 'SBI CSP', 'AEPS WITHDRAWAL', 1000);
  assert.equal(ok.valid, true);
  assert.equal(ok.accountKey, 'ko');
  assert.equal(ok.resultingBalance, 4000);

  const insufficient = validateWithdrawalBalance(balances, 'SBI CSP', 'AEPS WITHDRAWAL', 6000);
  assert.equal(insufficient.valid, false);
  assert.match(insufficient.error || '', /Insufficient KO Limit balance/);

  const zero = validateWithdrawalBalance(balances, 'AIRTEL CSP', 'AEPS WITHDRAWAL', 0);
  assert.equal(zero.valid, false);
});

test('SHOP internal transfers update the correct pair of accounts', () => {
  const bankToCh = computeAutoDeltas({
    type: 'SHOP',
    serviceType: 'BANK TO CH TRANSFER',
    paymentMode: 'Cash',
    debit: 0,
    credit: 15000,
  });
  assert.equal(bankToCh.cash, 15000);
  assert.equal(bankToCh.bank, -15000);

  const cashToBank = computeAutoDeltas({
    type: 'SHOP',
    serviceType: 'CASH TO BANK TRANSFER',
    paymentMode: 'Cash',
    debit: 8000,
    credit: 0,
  });
  assert.equal(cashToBank.cash, -8000);
  assert.equal(cashToBank.bank, 8000);

  const toKo = computeAutoDeltas({
    type: 'SHOP',
    serviceType: 'DEPOSIT TO KO LIMIT',
    paymentMode: 'Cash',
    debit: 20000,
    credit: 0,
  });
  assert.equal(toKo.ko, 20000);
  assert.equal(toKo.cash, -20000);
});

test('EXPENSE and Kerala House route through Cash vs ONLINE cleanly', () => {
  const expOnline = computeAutoDeltas({
    type: 'EXPENSE',
    serviceType: 'ELECTRICITY BILL SHOP',
    paymentMode: 'ONLINE',
    debit: 1450,
    credit: 0,
  });
  assert.equal(expOnline.bank, -1450);
  assert.equal(expOnline.cash, 0);

  const khCash = computeAutoDeltas({
    type: 'Kerala House',
    serviceType: 'Annual Maintenance Fee',
    paymentMode: 'Cash',
    debit: 0,
    credit: 1500,
  });
  assert.equal(khCash.cash, 1500);
});

test('Multi-day ledger deducts SBI CSP withdrawal from KO Limit and carries forward closing balances', () => {
  const state: AppState = {
    openingOverrides: {
      '2026-11-24': { ko: 50000, cash: 20000, fino: 0, airtel: 5000, bank: 30000, credit: 0 },
    },
    entriesByDate: {
      '2026-11-24': [
        {
          id: '1',
          date: '2026-11-24',
          type: 'SBI CSP',
          serviceType: 'AEPS WITHDRAWAL',
          remarks: 'Test',
          paymentMode: 'Cash',
          debit: 1000,
          credit: 0,
          customDeltas: null,
        },
        {
          id: '2',
          date: '2026-11-24',
          type: 'SHOP',
          serviceType: 'AADHAR CARD PRINT',
          remarks: '2x50',
          paymentMode: 'Cash',
          debit: 0,
          credit: 100,
          customDeltas: null,
        },
      ],
      '2026-11-25': [
        {
          id: '3',
          date: '2026-11-25',
          type: 'EXPENSE',
          serviceType: 'SHOP RENT',
          remarks: 'Nov',
          paymentMode: 'ONLINE',
          debit: 5000,
          credit: 0,
          customDeltas: null,
        },
      ],
    },
  };

  const day1 = computeDayLedger(state, '2026-11-24');
  assert.equal(day1.closing.ko, 49000);
  assert.equal(day1.closing.cash, 20100);
  assert.equal(day1.closing.total, 104100);

  const day2Open = getOpeningBalancesForDate(state, '2026-11-25');
  assert.equal(day2Open.isManual, false);
  assert.equal(day2Open.sourceDate, '2026-11-24');
  assert.equal(day2Open.balances.ko, 49000);
  assert.equal(day2Open.balances.cash, 20100);

  const day2 = computeDayLedger(state, '2026-11-25');
  assert.equal(day2.closing.bank, 25000);
  assert.equal(day2.closing.total, 99100);
});

test('Reversing (removing) a withdrawal entry restores the group balance exactly', () => {
  const baseState: AppState = {
    openingOverrides: {
      '2026-11-25': { ko: 50000, cash: 10000, fino: 0, airtel: 4000, bank: 20000, credit: 0 },
    },
    entriesByDate: {
      '2026-11-25': [
        {
          id: 'w1',
          date: '2026-11-25',
          type: 'SBI CSP',
          serviceType: 'AEPS WITHDRAWAL',
          remarks: 'Reversal test',
          paymentMode: 'Cash',
          debit: 1000,
          credit: 0,
          customDeltas: null,
        },
      ],
    },
  };
  assert.equal(computeDayLedger(baseState, '2026-11-25').closing.ko, 49000);

  const reversedState: AppState = {
    ...baseState,
    entriesByDate: { '2026-11-25': [] },
  };
  assert.equal(computeDayLedger(reversedState, '2026-11-25').closing.ko, 50000);
});

test('Mixed OLDTRN Excel dates disambiguate chronologically', () => {
  assert.equal(parseExcelMixedDate('13-08-2026', '2026-08-03'), '2026-08-13');
  assert.equal(parseExcelMixedDate('08/15/2026', '2026-08-13'), '2026-08-15');
  assert.equal(parseExcelMixedDate('6/9/2026', '2026-09-01'), '2026-09-06');
  assert.equal(parseExcelMixedDate('22/11/2026', '2026-11-20'), '2026-11-22');
  assert.equal(formatExcelDate('2026-11-25'), '11/25/2026');
  assert.equal(shiftISO('2026-11-25', 1), '2026-11-26');
});

test('isAepsWithdrawalService matches AEPS WITHDRAWAL case-insensitively and ignores other services', () => {
  assert.equal(isAepsWithdrawalService('AEPS WITHDRAWAL'), true);
  assert.equal(isAepsWithdrawalService('  aeps withdrawal  '), true);
  assert.equal(isAepsWithdrawalService('AEPS DEPOSIT'), false);
  assert.equal(isAepsWithdrawalService('MONEY TRANSFER'), false);
  assert.equal(isAepsWithdrawalService(''), false);
});

test('sanitizeDecimalInput accepts digits and at most one decimal point', () => {
  assert.equal(sanitizeDecimalInput('3500.50'), '3500.50');
  assert.equal(sanitizeDecimalInput('abc12.3.4e-5'), '12.345');
  assert.equal(sanitizeDecimalInput('-500'), '500');
});

test('calculateWithdrawalReduction routes each group to its wallet and ignores non-withdrawals', () => {
  const sbi = calculateWithdrawalReduction('SBI CSP', 'AEPS WITHDRAWAL', 1000);
  assert.equal(sbi.isWithdrawal, true);
  assert.equal(sbi.accountKey, 'ko');
  assert.equal(sbi.accountLabel, 'KO Limit');
  assert.equal(sbi.deltas.ko, -1000);

  const airtel = calculateWithdrawalReduction('AIRTEL CSP', 'AEPS WITHDRAWAL', 750);
  assert.equal(airtel.accountKey, 'airtel');
  assert.equal(airtel.deltas.airtel, -750);

  const shopOnline = calculateWithdrawalReduction('SHOP', 'SELF WITHDRAWAL', 500, 'ONLINE');
  assert.equal(shopOnline.accountKey, 'bank');
  assert.equal(shopOnline.deltas.bank, -500);

  const nonWithdrawal = calculateWithdrawalReduction('SBI CSP', 'AEPS DEPOSIT', 1000);
  assert.equal(nonWithdrawal.isWithdrawal, false);
  assert.equal(nonWithdrawal.reductionAmount, 0);
  assert.equal(nonWithdrawal.deltas.ko, 0);
});

test('applyEntryToLedgerAtomically deducts wallet balances, rejects overdrafts cleanly, and supports atomic edits', () => {
  const initialState: AppState = {
    initialized: true,
    openingOverrides: {
      '2026-11-25': { ko: 1500, cash: 5000, fino: 1000, airtel: 2000, bank: 10000, credit: 0 },
    },
    entriesByDate: {},
  };

  // 1. Valid SBI CSP AEPS withdrawal of 1000 reduces KO Limit 1500 -> 500 atomically
  const first = applyEntryToLedgerAtomically(initialState, {
    date: '2026-11-25',
    type: 'SBI CSP',
    serviceType: 'AEPS WITHDRAWAL',
    remarks: 'First withdrawal',
    paymentMode: 'Cash',
    debit: 1000,
    credit: 0,
    customDeltas: null,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.ledger.closing.ko, 500);
  assert.equal(first.walletReduction?.accountKey, 'ko');
  assert.equal(first.walletReduction?.previousBalance, 1500);
  assert.equal(first.walletReduction?.resultingBalance, 500);

  // 2. Back-to-back second withdrawal of 1000 fails atomically (only 500 left) and preserves state
  const second = applyEntryToLedgerAtomically(first.state, {
    date: '2026-11-25',
    type: 'SBI CSP',
    serviceType: 'ATM ONUS WITHDRAWAL',
    remarks: 'Overdraft attempt',
    paymentMode: 'Cash',
    debit: 1000,
    credit: 0,
    customDeltas: null,
  });
  assert.equal(second.ok, false);
  assert.equal(second.state, first.state);
  assert.equal(second.state.entriesByDate['2026-11-25']?.length, 1);

  // 3. Editing the first entry up to 1400 succeeds because its prior -1000 delta is backed out first
  const edited = applyEntryToLedgerAtomically(first.state, {
    id: first.entry.id,
    date: '2026-11-25',
    type: 'SBI CSP',
    serviceType: 'AEPS WITHDRAWAL',
    remarks: 'Updated withdrawal',
    paymentMode: 'Cash',
    debit: 1400,
    credit: 0,
    customDeltas: null,
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(edited.ledger.closing.ko, 100);
  assert.equal(edited.state.entriesByDate['2026-11-25']?.length, 1);

  // 4. AIRTEL CSP withdrawal deducts from Airtel Limit independently of KO Limit
  const airtelStep = applyEntryToLedgerAtomically(edited.state, {
    date: '2026-11-25',
    type: 'AIRTEL CSP',
    serviceType: 'AEPS WITHDRAWAL',
    remarks: 'Airtel payout',
    paymentMode: 'Cash',
    debit: 600,
    credit: 0,
    customDeltas: null,
  });
  assert.equal(airtelStep.ok, true);
  if (!airtelStep.ok) return;
  assert.equal(airtelStep.ledger.closing.airtel, 1400);
  assert.equal(airtelStep.ledger.closing.ko, 100);
});

test('buildDailyPerformanceChartData aggregates Debit vs Credit and Net by group and by entry', () => {
  const state: AppState = {
    initialized: true,
    openingOverrides: {
      '2026-11-25': { ko: 50000, cash: 20000, fino: 0, airtel: 5000, bank: 20000, credit: 0 },
    },
    entriesByDate: {
      '2026-11-25': [
        {
          id: 'e1',
          date: '2026-11-25',
          type: 'SBI CSP',
          serviceType: 'AEPS WITHDRAWAL',
          remarks: '',
          paymentMode: 'Cash',
          debit: 5000,
          credit: 0,
          customDeltas: null,
        },
        {
          id: 'e2',
          date: '2026-11-25',
          type: 'SBI CSP',
          serviceType: 'MONEY TRANSFER',
          remarks: '',
          paymentMode: 'Cash',
          debit: 0,
          credit: 10000,
          customDeltas: null,
        },
        {
          id: 'e3',
          date: '2026-11-25',
          type: 'EXPENSE',
          serviceType: 'INTERNET EXPENSE',
          remarks: '',
          paymentMode: 'ONLINE',
          debit: 799,
          credit: 0,
          customDeltas: null,
        },
      ],
    },
  };

  const ledger = computeDayLedger(state, '2026-11-25');

  const byGroup = buildDailyPerformanceChartData(ledger.rows, 'byGroup');
  assert.equal(byGroup.length, 2);
  assert.equal(byGroup[0].label, 'SBI CSP');
  assert.equal(byGroup[0].debit, 5000);
  assert.equal(byGroup[0].credit, 10000);
  assert.equal(byGroup[0].net, 5000);
  assert.equal(byGroup[1].label, 'EXPENSE');
  assert.equal(byGroup[1].debit, 799);
  assert.equal(byGroup[1].credit, 0);
  assert.equal(byGroup[1].net, -799);

  const byEntry = buildDailyPerformanceChartData(ledger.rows, 'byEntry');
  assert.equal(byEntry.length, 3);
  assert.deepEqual(
    byEntry.map((p) => ({ label: p.label, net: p.net })),
    [
      { label: '#1', net: -5000 },
      { label: '#2', net: 5000 },
      { label: '#3', net: 4201 },
    ]
  );
});
