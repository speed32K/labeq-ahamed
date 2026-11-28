import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEntryToLedgerAtomically,
  buildDailyPerformanceChartData,
  calculateWithdrawalReduction,
  classifyEntryAmount,
  computeAutoDeltas,
  computeDayLedger,
  getEntryAmount,
  getOpeningBalancesForDate,
  parseExcelMixedDate,
  formatExcelDate,
  shiftISO,
  isAepsWithdrawalService,
  isKoLimitDepositTransferService,
  isKoLimitDepositTransferTransaction,
  isSbiCspCashWithdrawal,
  isWithdrawalService,
  KO_LIMIT_DEPOSIT_TRANSFER_SERVICES,
  sanitizeDecimalInput,
  validateWithdrawalBalance,
} from './accounting';
import type { AppState } from '../types/ledger';

test('SBI CSP AEPS withdrawal of 1000 INR increases KO Limit by +1000 and decreases Cash In Hand by -1000', () => {
  const deltas = computeAutoDeltas({
    type: 'SBI CSP',
    serviceType: 'AEPS WITHDRAWAL',
    paymentMode: 'Cash',
    debit: 1000,
    credit: 0,
  });
  assert.equal(deltas.ko, 1000);
  assert.equal(deltas.cash, -1000);
  assert.equal(deltas.bank, 0);
  assert.equal(deltas.ko + deltas.cash, 0);
});

test('SBI CSP ATM OFFUS and ATM ONUS withdrawals proportionally increase KO Limit and decrease Cash In Hand', () => {
  const atmOffus = computeAutoDeltas({
    type: 'SBI CSP',
    serviceType: 'ATM OFFUS WITHDRAWAL',
    paymentMode: 'Cash',
    debit: 1750,
    credit: 0,
  });
  assert.equal(atmOffus.ko, 1750);
  assert.equal(atmOffus.cash, -1750);
  assert.equal(isSbiCspCashWithdrawal('SBI CSP', 'ATM OFFUS WITHDRAWAL'), true);

  const atmOnus = computeAutoDeltas({
    type: 'SBI CSP',
    serviceType: 'ATM ONUS WITHDRAWAL',
    paymentMode: 'Cash',
    debit: 2500,
    credit: 0,
  });
  assert.equal(atmOnus.ko, 2500);
  assert.equal(atmOnus.cash, -2500);
  assert.equal(isWithdrawalService('ATM ONUS WITHDRAWAL'), true);
  assert.equal(isSbiCspCashWithdrawal('SBI CSP', 'ATM ONUS WITHDRAWAL'), true);
  assert.equal(isSbiCspCashWithdrawal('AIRTEL CSP', 'AEPS WITHDRAWAL'), false);
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
  assert.equal(deltas.credit, 0);
});

test('Affected deposit/transfer types decrease KO Limit and increase Cash, Bank, or Not Paid (Credit) across SBI CSP, Airtel, InstantPay, and Fino', () => {
  const groups = ['SBI CSP', 'AIRTEL CSP', 'AIRTEL', 'INSTANTPAY', 'FINO'] as const;

  for (const group of groups) {
    for (const serviceType of KO_LIMIT_DEPOSIT_TRANSFER_SERVICES) {
      assert.equal(isKoLimitDepositTransferService(serviceType), true);
      assert.equal(isKoLimitDepositTransferTransaction(group, serviceType), true);

      const cashDeltas = computeAutoDeltas({
        type: group,
        serviceType,
        paymentMode: 'Cash',
        debit: 0,
        credit: 2000,
      });
      assert.equal(cashDeltas.ko, -2000, `${group} ${serviceType} Cash should decrease KO Limit`);
      assert.equal(cashDeltas.cash, 2000, `${group} ${serviceType} Cash should increase Cash In Hand`);
      assert.equal(cashDeltas.bank, 0);
      assert.equal(cashDeltas.credit, 0);

      const onlineDeltas = computeAutoDeltas({
        type: group,
        serviceType,
        paymentMode: 'ONLINE',
        debit: 0,
        credit: 3500,
      });
      assert.equal(onlineDeltas.ko, -3500, `${group} ${serviceType} ONLINE should decrease KO Limit`);
      assert.equal(onlineDeltas.bank, 3500, `${group} ${serviceType} ONLINE should increase Cash In Bank`);
      assert.equal(onlineDeltas.cash, 0);
      assert.equal(onlineDeltas.credit, 0);

      const creditDeltas = computeAutoDeltas({
        type: group,
        serviceType,
        paymentMode: 'CREDIT',
        debit: 1250,
        credit: 0,
      });
      assert.equal(creditDeltas.ko, -1250, `${group} ${serviceType} CREDIT should decrease KO Limit`);
      assert.equal(creditDeltas.credit, 1250, `${group} ${serviceType} CREDIT should increase Not Paid (Credit)`);
      assert.equal(creditDeltas.cash, 0);
      assert.equal(creditDeltas.bank, 0);
    }
  }

  // SHOP group is outside the 4 KO Limit deposit/transfer groups
  assert.equal(isKoLimitDepositTransferTransaction('SHOP', 'MONEY TRANSFER'), false);
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

test('validateWithdrawalBalance checks Cash In Hand for SBI CSP withdrawals and blocks overdrafts', () => {
  const balances = { ko: 5000, cash: 2000, fino: 0, airtel: 1500, bank: 10000, credit: 0 };

  const ok = validateWithdrawalBalance(balances, 'SBI CSP', 'AEPS WITHDRAWAL', 1000);
  assert.equal(ok.valid, true);
  assert.equal(ok.accountKey, 'cash');
  assert.equal(ok.accountLabel, 'Cash In Hand');
  assert.equal(ok.resultingBalance, 1000);

  const insufficient = validateWithdrawalBalance(balances, 'SBI CSP', 'ATM OFFUS WITHDRAWAL', 2500);
  assert.equal(insufficient.valid, false);
  assert.equal(insufficient.accountKey, 'cash');
  assert.match(insufficient.error || '', /Insufficient Cash In Hand balance/);

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

test('Multi-day ledger increases KO Limit and decreases Cash In Hand for SBI CSP withdrawals and carries forward balances', () => {
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
  assert.equal(day1.closing.ko, 51000);
  assert.equal(day1.closing.cash, 19100);
  assert.equal(day1.closing.total, 105100);

  const day2Open = getOpeningBalancesForDate(state, '2026-11-25');
  assert.equal(day2Open.isManual, false);
  assert.equal(day2Open.sourceDate, '2026-11-24');
  assert.equal(day2Open.balances.ko, 51000);
  assert.equal(day2Open.balances.cash, 19100);

  const day2 = computeDayLedger(state, '2026-11-25');
  assert.equal(day2.closing.bank, 25000);
  assert.equal(day2.closing.total, 100100);
});

test('Reversing (removing) an SBI CSP withdrawal entry restores both KO Limit and Cash In Hand exactly', () => {
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
  const withWithdrawal = computeDayLedger(baseState, '2026-11-25');
  assert.equal(withWithdrawal.closing.ko, 51000);
  assert.equal(withWithdrawal.closing.cash, 9000);

  const reversedState: AppState = {
    ...baseState,
    entriesByDate: { '2026-11-25': [] },
  };
  const afterReversal = computeDayLedger(reversedState, '2026-11-25');
  assert.equal(afterReversal.closing.ko, 50000);
  assert.equal(afterReversal.closing.cash, 10000);
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

test('calculateWithdrawalReduction routes SBI CSP to +KO/-Cash and other groups to their wallets', () => {
  const sbi = calculateWithdrawalReduction('SBI CSP', 'AEPS WITHDRAWAL', 1000);
  assert.equal(sbi.isWithdrawal, true);
  assert.equal(sbi.accountKey, 'cash');
  assert.equal(sbi.accountLabel, 'Cash In Hand');
  assert.equal(sbi.creditAccountKey, 'ko');
  assert.equal(sbi.creditAccountLabel, 'KO Limit');
  assert.equal(sbi.deltas.ko, 1000);
  assert.equal(sbi.deltas.cash, -1000);

  const sbiOffus = calculateWithdrawalReduction('SBI CSP', 'ATM OFFUS WITHDRAWAL', 500);
  assert.equal(sbiOffus.deltas.ko, 500);
  assert.equal(sbiOffus.deltas.cash, -500);

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
  assert.equal(nonWithdrawal.deltas.cash, 0);
});

test('applyEntryToLedgerAtomically credits KO Limit, deducts Cash In Hand, rejects cash overdrafts, and supports atomic edits', () => {
  const initialState: AppState = {
    initialized: true,
    openingOverrides: {
      '2026-11-25': { ko: 5000, cash: 1500, fino: 1000, airtel: 2000, bank: 10000, credit: 0 },
    },
    entriesByDate: {},
  };

  // 1. Valid SBI CSP AEPS withdrawal of 1000 increases KO Limit 5000 -> 6000 and reduces Cash In Hand 1500 -> 500
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
  assert.equal(first.ledger.closing.ko, 6000);
  assert.equal(first.ledger.closing.cash, 500);
  assert.equal(first.ledger.closing.total, 19500);
  assert.equal(first.walletReduction?.accountKey, 'cash');
  assert.equal(first.walletReduction?.previousBalance, 1500);
  assert.equal(first.walletReduction?.resultingBalance, 500);
  assert.equal(first.walletReduction?.creditAccountKey, 'ko');
  assert.equal(first.walletReduction?.creditResultingBalance, 6000);

  // 2. Back-to-back ATM ONUS withdrawal of 1000 fails atomically (only 500 Cash In Hand left) and preserves state
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

  // 3. Editing the first entry up to 1400 succeeds because its prior +1000 KO / -1000 Cash deltas are backed out first
  const edited = applyEntryToLedgerAtomically(first.state, {
    id: first.entry.id,
    date: '2026-11-25',
    type: 'SBI CSP',
    serviceType: 'ATM OFFUS WITHDRAWAL',
    remarks: 'Updated withdrawal',
    paymentMode: 'Cash',
    debit: 1400,
    credit: 0,
    customDeltas: null,
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(edited.ledger.closing.ko, 6400);
  assert.equal(edited.ledger.closing.cash, 100);
  assert.equal(edited.ledger.closing.total, 19500);
  assert.equal(edited.state.entriesByDate['2026-11-25']?.length, 1);

  // 4. AIRTEL CSP withdrawal deducts from Airtel Limit independently of KO Limit and Cash In Hand
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
  assert.equal(airtelStep.ledger.closing.ko, 6400);
  assert.equal(airtelStep.ledger.closing.cash, 100);
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

test('getEntryAmount and classifyEntryAmount unify Debit and Credit into a single Amount column', () => {
  assert.equal(getEntryAmount({ debit: 5000, credit: 0 }), 5000);
  assert.equal(getEntryAmount({ debit: 0, credit: 10000 }), 10000);
  assert.equal(getEntryAmount({ debit: 299, credit: 299 }), 299);

  const withdrawal = classifyEntryAmount('SBI CSP', 'AEPS WITHDRAWAL', 1500);
  assert.deepEqual(withdrawal, { debit: 1500, credit: 0 });
  const wDeltas = computeAutoDeltas({
    type: 'SBI CSP',
    serviceType: 'AEPS WITHDRAWAL',
    paymentMode: 'Cash',
    ...withdrawal,
  });
  assert.equal(wDeltas.ko, 1500);
  assert.equal(wDeltas.cash, -1500);

  const deposit = classifyEntryAmount('SBI CSP', 'INITIAL DEPOSIT', 2000);
  assert.deepEqual(deposit, { debit: 0, credit: 2000 });
  const dDeltas = computeAutoDeltas({
    type: 'SBI CSP',
    serviceType: 'INITIAL DEPOSIT',
    paymentMode: 'CREDIT',
    ...deposit,
  });
  assert.equal(dDeltas.ko, -2000);
  assert.equal(dDeltas.credit, 2000);

  const recharge = classifyEntryAmount('AIRTEL CSP', 'MOBILE RECHARGE', 299);
  const rDeltas = computeAutoDeltas({
    type: 'AIRTEL CSP',
    serviceType: 'MOBILE RECHARGE',
    paymentMode: 'Cash',
    ...recharge,
  });
  assert.equal(rDeltas.airtel, -299);
  assert.equal(rDeltas.cash, 299);

  const expense = classifyEntryAmount('EXPENSE', 'SHOP RENT', 5000);
  assert.deepEqual(expense, { debit: 5000, credit: 0 });
  const eDeltas = computeAutoDeltas({
    type: 'EXPENSE',
    serviceType: 'SHOP RENT',
    paymentMode: 'ONLINE',
    ...expense,
  });
  assert.equal(eDeltas.bank, -5000);
});
