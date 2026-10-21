import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const cn = (...parts) => parts.filter(Boolean).join(' ');

const ToastContext = createContext(null);

const variantStyles = {
  default: 'border-slate-200',
  success: 'border-emerald-200',
  danger: 'border-red-200',
  warning: 'border-amber-200',
  info: 'border-sky-200',
};

const variantIcons = {
  default: Info,
  success: CheckCircle2,
  danger: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const variantIconColors = {
  default: 'text-slate-500',
  success: 'text-emerald-600',
  danger: 'text-red-600',
  warning: 'text-amber-600',
  info: 'text-sky-600',
};

/**
 * Toast tối giản theo context.
 *
 * Bọc app:  <ToastProvider>...</ToastProvider>
 * Trong component con:
 *   const { toast } = useToast();
 *   toast({ title: 'Đã lưu', description: '...', variant: 'success' });
 *   toast({ title: 'Lỗi', variant: 'danger', duration: 8000 });
 *
 * Toast tự đóng sau `duration` ms (mặc định 5000), có nút đóng,
 * vùng hiển thị aria-live="polite" ở góc phải dưới, phẳng, shadow-sm.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, variant = 'default', duration = 5000 }) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((prev) => [...prev.slice(-3), { id, title, description, variant }]);
      if (duration > 0) window.setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => {
          const Icon = variantIcons[t.variant] ?? Info;
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                'pointer-events-auto flex animate-toast-in items-start gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm',
                variantStyles[t.variant] ?? variantStyles.default,
              )}
            >
              <Icon
                className={cn('mt-0.5 h-4 w-4 shrink-0', variantIconColors[t.variant] ?? variantIconColors.default)}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-sm font-medium text-slate-900">{t.title}</p>}
                {t.description && <p className="mt-0.5 text-sm text-slate-600">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Đóng thông báo"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast phải được dùng bên trong <ToastProvider>');
  return ctx;
}

export default ToastProvider;
