import * as XLSX from 'xlsx';
import type { AppState, BalanceSnapshot, LogEntry } from '../types/ledger';
import {
  classifyEntryAmount,
  computeAutoDeltas,
  computeDayLedger,
  formatExcelDate,
  getEntryAmount,
  getSortedDates,
  parseExcelMixedDate,
  parseNumOrNull,
  round2,
} from './accounting';

export const OLDTRN_HEADERS = [
  'Date',
  'Type',
  'Service Type',
  'Remarks',
  'Payment Mode',
  'Amount',
  'KO Limit',
  'Cash In Hand',
  'Fino Limit',
  'Airtel Limit',
  'Cash In Bank',
  'Credit',
  'Total',
] as const;

export function buildLedgerWorkbook(
  state: AppState,
  selectedDate: string,
  allDates = false
): { workbook: XLSX.WorkBook; rowCount: number } {
  const datesToExport = allDates ? getSortedDates(state) : [selectedDate];
  const aoa: unknown[][] = [[...OLDTRN_HEADERS]];
  let excelRowNum = 2;

  for (const d of datesToExport) {
    const { rows } = computeDayLedger(state, d);
    for (const r of rows) {
      const amount = getEntryAmount(r);
      aoa.push([
        formatExcelDate(r.date),
        r.type === 'AIRTEL CSP' ? 'AIRTEL' : r.type,
        r.serviceType,
        r.remarks || '',
        r.paymentMode || 'Cash',
        amount || null,
        r.running.ko,
        r.running.cash,
        r.running.fino,
        r.running.airtel,
        r.running.bank,
        r.running.credit,
        { t: 'n', v: r.running.total, f: `SUM(G${excelRowNum}:L${excelRowNum})` },
      ]);
      excelRowNum++;
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 28 },
    { wch: 24 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 12 },
    { wch: 12 },
    { wch: 13 },
    { wch: 10 },
    { wch: 14 },
  ];

  const ref = ws['!ref'];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 5; C <= 12; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[addr] && typeof ws[addr].v === 'number') {
          ws[addr].z = '#,##0.00';
        }
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'OLDTRN');
  return { workbook: wb, rowCount: aoa.length - 1 };
}

export function exportLedgerXlsx(
  state: AppState,
  selectedDate: string,
  allDates = false
): { exported: boolean; filename: string; rowCount: number } {
  const { workbook, rowCount } = buildLedgerWorkbook(state, selectedDate, allDates);
  const filename = allDates ? 'shop_all_logs.xlsx' : `shop_log_${selectedDate}.xlsx`;
  if (rowCount === 0) {
    return { exported: false, filename, rowCount: 0 };
  }
  XLSX.writeFile(workbook, filename);
  return { exported: true, filename, rowCount };
}

export interface ParsedWorkbookImport {
  entriesByDate: Record<string, LogEntry[]>;
  openingOverrides: Record<string, BalanceSnapshot>;
  importedCount: number;
  lastDate: string;
}

export function parseWorkbookToImport(
  data: ArrayBuffer | Uint8Array,
  fallbackDate: string
): ParsedWorkbookImport {
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.includes('OLDTRN') ? 'OLDTRN' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
  });

  const headerRow = rows[0] || [];
  const col5Header = String(headerRow[5] ?? '').trim().toLowerCase();
  const isUnifiedAmountSchema = col5Header === 'amount';
  const balStartCol = isUnifiedAmountSchema ? 6 : 7;

  const entriesByDate: Record<string, LogEntry[]> = {};
  const openingOverrides: Record<string, BalanceSnapshot> = {};

  let lastValidDate = fallbackDate;
  let prevBal: BalanceSnapshot | null = null;
  let importedCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || (!row[1] && !row[2] && !row[5] && (isUnifiedAmountSchema || !row[6]))) continue;

    const isoDate = parseExcelMixedDate(row[0], lastValidDate, (serial) => {
      const parsed = XLSX.SSF.parse_date_code(serial);
      return parsed ? { y: parsed.y, m: parsed.m, d: parsed.d } : null;
    });
    lastValidDate = isoDate;

    let rawType = String(row[1] ?? 'SHOP').trim();
    if (rawType.toUpperCase() === 'AIRTEL') rawType = 'AIRTEL CSP';

    const serviceType = String(row[2] ?? '').trim();
    const remarks = String(row[3] ?? '').trim();
    const paymentMode = String(row[4] ?? 'Cash').trim() || 'Cash';

    let debit = 0;
    let credit = 0;
    if (isUnifiedAmountSchema) {
      const amount = round2(parseFloat(String(row[5] ?? 0)) || 0);
      const classified = classifyEntryAmount(rawType, serviceType, amount);
      debit = classified.debit;
      credit = classified.credit;
    } else {
      debit = round2(parseFloat(String(row[5] ?? 0)) || 0);
      credit = round2(parseFloat(String(row[6] ?? 0)) || 0);
    }

    const rowBal = {
      ko: parseNumOrNull(row[balStartCol]),
      cash: parseNumOrNull(row[balStartCol + 1]),
      fino: parseNumOrNull(row[balStartCol + 2]),
      airtel: parseNumOrNull(row[balStartCol + 3]),
      bank: parseNumOrNull(row[balStartCol + 4]),
      credit: parseNumOrNull(row[balStartCol + 5]),
    };

    const hasSheetBalances = Object.values(rowBal).some((v) => v !== null);
    let customDeltas: BalanceSnapshot | null = null;

    if (hasSheetBalances) {
      if (prevBal === null) {
        const auto = computeAutoDeltas({
          type: rawType,
          serviceType,
          paymentMode,
          debit,
          credit,
        });
        openingOverrides[isoDate] = {
          ko: round2((rowBal.ko ?? 0) - auto.ko),
          cash: round2((rowBal.cash ?? 0) - auto.cash),
          fino: round2((rowBal.fino ?? 0) - auto.fino),
          airtel: round2((rowBal.airtel ?? 0) - auto.airtel),
          bank: round2((rowBal.bank ?? 0) - auto.bank),
          credit: round2((rowBal.credit ?? 0) - auto.credit),
        };
        prevBal = {
          ko: rowBal.ko ?? 0,
          cash: rowBal.cash ?? 0,
          fino: rowBal.fino ?? 0,
          airtel: rowBal.airtel ?? 0,
          bank: rowBal.bank ?? 0,
          credit: rowBal.credit ?? 0,
        };
      } else {
        const auto = computeAutoDeltas({
          type: rawType,
          serviceType,
          paymentMode,
          debit,
          credit,
        });
        const next: BalanceSnapshot = {
          ko: rowBal.ko ?? prevBal.ko,
          cash: rowBal.cash ?? prevBal.cash,
          fino: rowBal.fino ?? prevBal.fino,
          airtel: rowBal.airtel ?? prevBal.airtel,
          bank: rowBal.bank ?? prevBal.bank,
          credit: rowBal.credit ?? prevBal.credit,
        };
        const actualDelta: BalanceSnapshot = {
          ko: round2(next.ko - prevBal.ko),
          cash: round2(next.cash - prevBal.cash),
          fino: round2(next.fino - prevBal.fino),
          airtel: round2(next.airtel - prevBal.airtel),
          bank: round2(next.bank - prevBal.bank),
          credit: round2(next.credit - prevBal.credit),
        };
        const keys: Array<keyof BalanceSnapshot> = ['ko', 'cash', 'fino', 'airtel', 'bank', 'credit'];
        const differs = keys.some((k) => Math.abs(auto[k] - actualDelta[k]) > 0.01);
        if (differs) customDeltas = actualDelta;
        prevBal = next;
      }
    }

    if (!entriesByDate[isoDate]) entriesByDate[isoDate] = [];
    entriesByDate[isoDate].push({
      id: `imp_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      date: isoDate,
      type: rawType,
      serviceType,
      remarks,
      paymentMode,
      debit,
      credit,
      customDeltas,
    });
    importedCount++;
  }

  return {
    entriesByDate,
    openingOverrides,
    importedCount,
    lastDate: lastValidDate,
  };
}
