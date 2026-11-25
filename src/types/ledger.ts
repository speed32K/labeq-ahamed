export type BusinessGroupName =
  | 'SBI CSP'
  | 'AIRTEL CSP'
  | 'INSTANTPAY'
  | 'SHOP'
  | 'Kerala House'
  | 'Tehrik e Jadeed'
  | 'EXPENSE'
  | 'FINO';

export type PaymentMode = 'Cash' | 'ONLINE' | 'CREDIT';

export interface BalanceSnapshot {
  ko: number;
  cash: number;
  fino: number;
  airtel: number;
  bank: number;
  credit: number;
}

export interface RunningBalances extends BalanceSnapshot {
  total: number;
}

export interface LogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  type: BusinessGroupName | string;
  serviceType: string;
  remarks: string;
  paymentMode: PaymentMode | string;
  debit: number;
  credit: number;
  customDeltas: BalanceSnapshot | null;
}

export interface ComputedLedgerRow extends LogEntry {
  seq: number;
  deltas: BalanceSnapshot;
  running: RunningBalances;
}

export interface DayLedgerResult {
  opening: BalanceSnapshot;
  isManual: boolean;
  sourceDate: string | null;
  closing: RunningBalances;
  rows: ComputedLedgerRow[];
}

export interface AppState {
  entriesByDate: Record<string, LogEntry[]>;
  openingOverrides: Record<string, BalanceSnapshot>;
  customServices?: Record<string, string[]>;
  initialized?: boolean;
}

export interface DynamicFieldSpec {
  id: string;
  label: string;
  type?: 'text' | 'number';
  placeholder: string;
}

export interface GroupDefinition {
  name: BusinessGroupName;
  shortLabel: string;
  color: string;
  textClass: string;
  services: string[];
  dynamicFields: DynamicFieldSpec[];
  description: string;
}
