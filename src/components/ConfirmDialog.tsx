import { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  secondaryLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onSecondary?: () => void;
}

interface ConfirmDialogProps {
  dialog: ConfirmDialogState | null;
  onClose: () => void;
}

export function ConfirmDialog({ dialog, onClose }: ConfirmDialogProps) {
  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialog, onClose]);

  if (!dialog) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">
            {dialog.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close confirmation dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-sm text-slate-600 leading-relaxed">{dialog.message}</p>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {dialog.secondaryLabel && dialog.onSecondary && (
              <button
                type="button"
                onClick={() => {
                  const fn = dialog.onSecondary;
                  onClose();
                  fn?.();
                }}
                className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                {dialog.secondaryLabel}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const fn = dialog.onConfirm;
                onClose();
                fn();
              }}
              className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors cursor-pointer ${
                dialog.destructive
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-[#1f5e4b] hover:bg-[#17483a]'
              }`}
            >
              {dialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
