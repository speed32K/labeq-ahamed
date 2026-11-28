import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildLedgerWorkbook, OLDTRN_HEADERS, parseWorkbookToImport } from './excel';
import { computeDayLedger } from './accounting';
import type { AppState } from '../types/ledger';

test('Exported OLDTRN workbook preserves headers, formulas, AIRTEL mapping, and round-trip balances', () => {
  const state: AppState = {
    openingOverrides: {
      '2026-11-25': { ko: 50000, cash: 10000, fino: 0, airtel: 4000, bank: 20000, credit: 0 },
    },
    entriesByDate: {
      '2026-11-25': [
        {
          id: 'e1',
          date: '2026-11-25',
          type: 'AIRTEL CSP',
          serviceType: 'AEPS WITHDRAWAL',
          remarks: 'Airtel test',
          paymentMode: 'Cash',
          debit: 1500,
          credit: 0,
          customDeltas: null,
        },
        {
          id: 'e2',
          date: '2026-11-25',
          type: 'SHOP',
          serviceType: 'PHOTOCOPY',
          remarks: 'Custom adjustment',
          paymentMode: 'Cash',
          debit: 0,
          credit: 250,
          customDeltas: { ko: 0, cash: 200, fino: 0, airtel: 0, bank: 50, credit: 0 },
        },
      ],
    },
  };

  const { workbook, rowCount } = buildLedgerWorkbook(state, '2026-11-25', true);
  assert.equal(rowCount, 2);
  assert.ok(workbook.SheetNames.includes('OLDTRN'));

  const sheet = workbook.Sheets['OLDTRN'];
  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0];
  const headerNames: string[] = headerRow.map(String);
  assert.equal(headerNames.includes('Amount'), true);
  assert.equal(headerNames.includes('Debit'), false);
  assert.deepEqual(headerNames, [...OLDTRN_HEADERS]);
  assert.equal(sheet['B2'].v, 'AIRTEL');
  assert.equal(sheet['F2'].v, 1500);
  assert.equal(sheet['M2'].f, 'SUM(G2:L2)');
  assert.equal(sheet['M3'].f, 'SUM(G3:L3)');

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  const imported = parseWorkbookToImport(buffer, '2026-11-25');

  assert.equal(imported.importedCount, 2);
  assert.equal(imported.entriesByDate['2026-11-25'][0].type, 'AIRTEL CSP');

  const rehydrated: AppState = {
    entriesByDate: imported.entriesByDate,
    openingOverrides: imported.openingOverrides,
  };
  const originalLedger = computeDayLedger(state, '2026-11-25');
  const importedLedger = computeDayLedger(rehydrated, '2026-11-25');

  assert.deepEqual(importedLedger.closing, originalLedger.closing);
});

test('Legacy 14-column Debit/Credit workbooks still import cleanly for backward compatibility', () => {
  const legacyAoa = [
    [
      'Date',
      'Type',
      'Service Type',
      'Remarks',
      'Payment Mode',
      'Debit',
      'Credit',
      'KO Limit',
      'Cash In Hand',
      'Fino Limit',
      'Airtel Limit',
      'Cash In Bank',
      'Credit',
      'Total',
    ],
    ['11/25/2026', 'SBI CSP', 'MONEY TRANSFER', 'Legacy row', 'Cash', 0, 2000, 48000, 12000, 0, 0, 0, 0, 60000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(legacyAoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'OLDTRN');
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;

  const imported = parseWorkbookToImport(buffer, '2026-11-25');
  assert.equal(imported.importedCount, 1);
  assert.equal(imported.entriesByDate['2026-11-25'][0].credit, 2000);
  assert.equal(imported.openingOverrides['2026-11-25'].ko, 50000);
  assert.equal(imported.openingOverrides['2026-11-25'].cash, 10000);
});
