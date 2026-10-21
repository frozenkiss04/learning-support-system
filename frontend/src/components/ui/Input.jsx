import { forwardRef, useId } from 'react';

const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Input một dòng. Hỗ trợ: error (string|boolean), helperText,
 * leftIcon / rightIcon (ReactNode, thường là Lucide icon h-4 w-4),
 * disabled, className. Tự sinh id nếu không truyền và nối
 * aria-describedby / aria-invalid theo trạng thái lỗi.
 */
export const Input = forwardRef(function Input(
  { id, error, helperText, leftIcon, rightIcon, disabled = false, className, wrapperClassName, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = helperText ? `${inputId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const hasError = Boolean(error);

  return (
    <div className={wrapperClassName}>
      <div className="relative">
        {leftIcon && (
          <span
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex h-9 w-full rounded-md border bg-white px-3 py-1 text-sm text-slate-900 shadow-sm transition-colors',
            'placeholder:text-slate-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
            hasError
              ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-100'
              : 'border-slate-300 hover:border-slate-400 focus-visible:border-primary-700 focus-visible:ring-primary-100',
            leftIcon && 'pl-9',
            rightIcon && 'pr-9',
            className,
          )}
          {...props}
        />
        {rightIcon && (
          <span
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400"
            aria-hidden="true"
          >
            {rightIcon}
          </span>
        )}
      </div>
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

export default Input;
