import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Dialog (modal) tối giản, không phụ thuộc thư viện ngoài:
 * overlay slate-900/50 phẳng, hộp thoại trắng bo 8px shadow-sm,
 * đóng bằng Esc / click nền / nút X, khóa cuộn nền khi mở,
 * role="dialog" aria-modal + aria-labelledby tới DialogTitle.
 *
 * Dùng:
 * <Dialog open={open} onClose={...}>
 *   <DialogHeader><DialogTitle>...</DialogTitle>
 *     <DialogDescription>...</DialogDescription></DialogHeader>
 *   <DialogBody>...</DialogBody>
 *   <DialogFooter>...</DialogFooter>
 * </Dialog>
 */
export function Dialog({ open = false, onClose, labelledBy = 'dialog-title', className, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          'relative max-h-[90vh] w-full max-w-lg animate-dialog-in overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm outline-none',
          className,
        )}
      >
        {children}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn('border-b border-slate-100 px-5 py-4 pr-12', className)} {...props} />;
}

export function DialogTitle({ id = 'dialog-title', className, ...props }) {
  return (
    <h2 id={id} className={cn('text-base font-semibold tracking-tight text-slate-900', className)} {...props} />
  );
}

export function DialogDescription({ className, ...props }) {
  return <p className={cn('mt-1 text-sm text-slate-600', className)} {...props} />;
}

export function DialogBody({ className, ...props }) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export default Dialog;
