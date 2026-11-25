import { useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { getGroupColor, getGroupTextClass, GROUP_ORDER } from '../data/groups';
import type { RemoteEntrySyncKind } from '../lib/remoteSyncTrigger';
import type { ComputedLedgerRow } from '../types/ledger';
import { formatNum } from '../utils/accounting';
import { splitHighlightSegments } from '../utils/highlight';

function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = splitHighlightSegments(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            data-testid="search-highlight"
            className="bg-amber-200/85 text-slate-950 rounded-[3px] px-0.5 font-inherit"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}

interface CanvasBoardProps {
  allDayRows: ComputedLedgerRow[];
  visibleRows: ComputedLedgerRow[];
  filterGroup: string;
  searchQuery: string;
  editingEntryId: string | null;
  remoteSyncedEntryIds?: Record<string, RemoteEntrySyncKind>;
  chartSlot?: ReactNode;
  onChangeFilterGroup: (group: string) => void;
  onChangeSearchQuery: (q: string) => void;
  onEditEntry: (id: string) => void;
  onDeleteEntry: (row: ComputedLedgerRow) => void;
  onReorderEntries: (fromId: string, toId: string) => void;
  onMoveEntryByOffset: (id: string, offset: -1 | 1) => void;
  onFocusComposer: () => void;
}

export function CanvasBoard({
  allDayRows,
  visibleRows,
  filterGroup,
  searchQuery,
  editingEntryId,
  remoteSyncedEntryIds,
  chartSlot,
  onChangeFilterGroup,
  onChangeSearchQuery,
  onEditEntry,
  onDeleteEntry,
  onReorderEntries,
  onMoveEntryByOffset,
  onFocusComposer,
}: CanvasBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const canReorder = filterGroup === 'ALL' && searchQuery.trim() === '';

  // Day totals & per-group aggregates
  let dayDebit = 0;
  let dayCredit = 0;
  const groupStats = new Map<string, { count: number; debit: number; credit: number }>();

  for (const r of allDayRows) {
    dayDebit += r.debit || 0;
    dayCredit += r.credit || 0;
    const prev = groupStats.get(r.type) || { count: 0, debit: 0, credit: 0 };
    groupStats.set(r.type, {
      count: prev.count + 1,
      debit: prev.debit + (r.debit || 0),
      credit: prev.credit + (r.credit || 0),
    });
  }

  const dayNet = dayCredit - dayDebit;

  return (
    <section
      aria-label="Daily log canvas workspace"
      className="flex-1 min-w-0 flex flex-col"
    >
      {/* Day Summary & Filter Toolbar */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <span className="block text-[11px] text-slate-500">Entries</span>
            <strong
              data-testid="day-entry-count"
              className="text-sm font-semibold font-mono tabular-nums text-slate-900"
            >
              {allDayRows.length}
            </strong>
          </div>
          <div>
            <span className="block text-[11px] text-slate-500">Day Debit (Dr)</span>
            <strong
              data-testid="day-total-debit"
              className="text-sm font-semibold font-mono tabular-nums text-red-700"
            >
              {formatNum(dayDebit)}
            </strong>
          </div>
          <div>
            <span className="block text-[11px] text-slate-500">Day Credit (Cr)</span>
            <strong
              data-testid="day-total-credit"
              className="text-sm font-semibold font-mono tabular-nums text-emerald-700"
            >
              {formatNum(dayCredit)}
            </strong>
          </div>
          <div>
            <span className="block text-[11px] text-slate-500">Net Flow</span>
            <strong
              data-testid="day-net-flow"
              className={`text-sm font-semibold font-mono tabular-nums ${
                dayNet < 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {dayNet > 0 ? '+' : ''}
              {formatNum(dayNet)}
            </strong>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <select
            aria-label="Filter canvas by business group"
            value={filterGroup}
            onChange={(e) => onChangeFilterGroup(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:border-[#1f5e4b]"
          >
            <option value="ALL">All Groups</option>
            {GROUP_ORDER.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <div className="relative flex-1 sm:w-52">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search entries"
              value={searchQuery}
              onChange={(e) => onChangeSearchQuery(e.target.value)}
              placeholder="Search service, remarks, mode..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1f5e4b]"
            />
          </div>
        </div>
      </div>

      {/* Unboxed Per-Group Day Totals Strip (Zero-Pill Discipline) */}
      {groupStats.size > 0 && (
        <div
          aria-label="Per-group daily totals"
          className="bg-slate-50 border-b border-slate-200 px-4 sm:px-6 py-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs"
        >
          {Array.from(groupStats.entries()).map(([grp, st]) => (
            <button
              key={grp}
              type="button"
              onClick={() => onChangeFilterGroup(filterGroup === grp ? 'ALL' : grp)}
              className={`inline-flex items-center gap-1.5 text-left hover:underline cursor-pointer ${
                filterGroup === grp ? 'font-semibold text-slate-900' : 'text-slate-600'
              }`}
            >
              <span className={`font-semibold ${getGroupTextClass(grp)}`}>{grp}</span>
              <span className="text-slate-400">({st.count})</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="font-mono tabular-nums text-red-700">
                Dr {formatNum(st.debit)}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                /
              </span>
              <span className="font-mono tabular-nums text-emerald-700">
                Cr {formatNum(st.credit)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Interactive Dot-Grid Canvas Surface */}
      <div className="flex-1 canvas-dot-grid p-4 sm:p-6 overflow-y-auto">
        {chartSlot}
        {visibleRows.length === 0 ? (
          <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-xl p-8 text-center">
            <h2 className="text-base font-semibold text-slate-900">
              {allDayRows.length === 0
                ? 'No entries on the canvas for this date'
                : 'No entries match your current filter'}
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              {allDayRows.length === 0
                ? 'Select a business group in the composer to record a transaction, or import an existing Excel log.'
                : 'Try clearing the group filter or search term to view all entries logged for this day.'}
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              {allDayRows.length === 0 ? (
                <button
                  type="button"
                  onClick={onFocusComposer}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1f5e4b] hover:bg-[#17483a] rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Log First Entry</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onChangeFilterGroup('ALL');
                    onChangeSearchQuery('');
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            data-testid="canvas-card-grid"
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start"
          >
            {visibleRows.map((row, idx) => {
              const color = getGroupColor(row.type);
              const isEditing = editingEntryId === row.id;
              const remoteSyncKind = remoteSyncedEntryIds?.[row.id];
              const isDragged = draggedId === row.id;
              const isDragTarget = dragOverId === row.id && draggedId !== row.id;

              return (
                <article
                  key={row.id}
                  data-testid={`entry-card-${row.seq}`}
                  data-entry-id={row.id}
                  draggable={canReorder}
                  onDragStart={() => setDraggedId(row.id)}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  onDragOver={(e) => {
                    if (!canReorder) return;
                    e.preventDefault();
                    if (dragOverId !== row.id) setDragOverId(row.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedId && draggedId !== row.id) {
                      onReorderEntries(draggedId, row.id);
                    }
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  style={{ borderTopColor: color }}
                  className={`bg-white border border-slate-200 border-t-2 rounded-lg p-4 flex flex-col gap-3 transition-shadow ${
                    isEditing
                      ? 'ring-2 ring-[#1f5e4b]/40 border-[#1f5e4b]'
                      : remoteSyncKind
                        ? 'ring-2 ring-emerald-500/45 border-emerald-400 bg-emerald-50/20'
                        : 'hover:shadow-sm'
                  } ${isDragged ? 'opacity-50' : ''} ${
                    isDragTarget ? 'ring-2 ring-slate-400 border-dashed' : ''
                  }`}
                >
                  {/* Quiet 1-line Unboxed Metadata Kicker + Card Actions */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs min-w-0 truncate">
                      {canReorder && (
                        <GripVertical
                          className="w-3.5 h-3.5 text-slate-400 shrink-0 cursor-grab"
                          aria-hidden="true"
                        />
                      )}
                      <span className="font-mono tabular-nums text-slate-500">#{row.seq}</span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className={`font-semibold truncate ${getGroupTextClass(row.type)}`}>
                        {row.type}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span data-testid="card-payment-mode" className="text-slate-600 shrink-0">
                        <HighlightedText text={row.paymentMode || 'Cash'} query={searchQuery} />
                      </span>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      {canReorder && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => onMoveEntryByOffset(row.id, -1)}
                            aria-label={`Move entry #${row.seq} ${row.serviceType} up`}
                            className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === visibleRows.length - 1}
                            onClick={() => onMoveEntryByOffset(row.id, 1)}
                            aria-label={`Move entry #${row.seq} ${row.serviceType} down`}
                            className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditEntry(row.id)}
                        aria-label={`Edit entry #${row.seq} ${row.serviceType}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteEntry(row)}
                        aria-label={`Delete entry #${row.seq} ${row.serviceType}`}
                        className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Service Title & Remarks */}
                  <div>
                    {remoteSyncKind && (
                      <div
                        data-testid="remote-synced-badge"
                        className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#1f5e4b]"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[#1f5e4b] shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          {remoteSyncKind === 'added'
                            ? 'Synced from remote device · Added'
                            : 'Synced from remote device · Updated'}
                        </span>
                      </div>
                    )}
                    <h3
                      data-testid="card-service-type"
                      className="text-[15px] font-semibold text-slate-900 leading-snug"
                    >
                      <HighlightedText text={row.serviceType} query={searchQuery} />
                    </h3>
                    <p
                      data-testid="card-remarks"
                      className="mt-0.5 text-xs text-slate-600 min-h-[1rem]"
                    >
                      {row.remarks ? (
                        <HighlightedText text={row.remarks} query={searchQuery} />
                      ) : (
                        'No remarks'
                      )}
                      {row.customDeltas ? ' · Custom deltas' : ''}
                    </p>
                  </div>

                  {/* Debit / Credit Row (Hairline Dividers, Zero Nested Cards) */}
                  <div className="grid grid-cols-2 divide-x divide-slate-200 border-y border-slate-100 py-2.5">
                    <div className="pr-3">
                      <span className="block text-[11px] text-slate-500">Debit (Dr)</span>
                      <span className="mt-0.5 block text-sm font-semibold font-mono tabular-nums text-red-700">
                        {row.debit > 0 ? formatNum(row.debit) : '—'}
                      </span>
                    </div>
                    <div className="pl-3">
                      <span className="block text-[11px] text-slate-500">Credit (Cr)</span>
                      <span className="mt-0.5 block text-sm font-semibold font-mono tabular-nums text-emerald-700">
                        {row.credit > 0 ? formatNum(row.credit) : '—'}
                      </span>
                    </div>
                  </div>

                  {/* 6-Account Running Balances Snapshot (2x3 on small mobile, 3x2 on sm+) */}
                  <div
                    data-testid="card-balance-grid"
                    className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2.5 sm:gap-x-2 sm:gap-y-2 text-xs sm:text-[11px]"
                  >
                    <div className="min-w-0">
                      <span className="block text-[11px] text-slate-500">KO Limit</span>
                      <span className="block font-mono tabular-nums font-medium text-slate-800 truncate">
                        {formatNum(row.running.ko)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[11px] text-slate-500">Cash Hand</span>
                      <span className="block font-mono tabular-nums font-medium text-slate-800 truncate">
                        {formatNum(row.running.cash)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[11px] text-slate-500">Cash Bank</span>
                      <span className="block font-mono tabular-nums font-medium text-slate-800 truncate">
                        {formatNum(row.running.bank)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[11px] text-slate-500">Fino</span>
                      <span className="block font-mono tabular-nums font-medium text-slate-800 truncate">
                        {formatNum(row.running.fino)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[11px] text-slate-500">Airtel</span>
                      <span className="block font-mono tabular-nums font-medium text-slate-800 truncate">
                        {formatNum(row.running.airtel)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[11px] text-slate-500">Credit</span>
                      <span className="block font-mono tabular-nums font-medium text-slate-800 truncate">
                        {formatNum(row.running.credit)}
                      </span>
                    </div>
                  </div>

                  {/* Card Footer Running Total */}
                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-500">Running Total</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {formatNum(row.running.total)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
