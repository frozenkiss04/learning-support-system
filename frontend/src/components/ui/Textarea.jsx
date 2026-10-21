import { forwardRef, useId } from 'react';

const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Textarea nhiều dòng, cùng hệ thị giác với Input.
 * Props: rows (mặc định 4), error, helperText, disabled, className.
 */
export const Textarea = forwardRef(function Textarea(
  { id, rows = 4, error, helperText, disabled = false, className, wrapperClassName, ...props },
  ref,
) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const hasError = Boolean(error);
  const errorId = hasError ? `${textareaId}-error` : undefined;
  const hintId = helperText ? `${textareaId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={wrapperClassName}>
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        disabled={disabled}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        className={cn(
          'flex w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors',
          'placeholder:text-slate-400',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          hasError
            ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-100'
            : 'border-slate-300 hover:border-slate-400 focus-visible:border-primary-700 focus-visible:ring-primary-100',
          className,
        )}
        {...props}
      />
      {hasError && typeof error === 'string' && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
      {helperText && !hasError && (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">
          {helperText}
        </p>
      )}
    </div>
  );
});

export default Textarea;
