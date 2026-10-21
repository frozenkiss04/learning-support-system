import { forwardRef, useId } from 'react';
import { ChevronDown } from 'lucide-react';

const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Select dùng thẻ <select> gốc: ổn định, accessible, dùng được với bàn phím.
 * Truyền options=[{value,label,disabled}] hoặc children <option>.
 * Props: error, helperText, placeholder, disabled, className.
 */
export const Select = forwardRef(function Select(
  {
    id,
    options,
    placeholder,
    error,
    helperText,
    disabled = false,
    className,
    wrapperClassName,
    children,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hasError = Boolean(error);
  const errorId = hasError ? `${selectId}-error` : undefined;
  const hintId = helperText ? `${selectId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={wrapperClassName}>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex h-9 w-full appearance-none rounded-md border bg-white pl-3 pr-9 py-1 text-sm text-slate-900 shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
            hasError
              ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-100'
              : 'border-slate-300 hover:border-slate-400 focus-visible:border-primary-700 focus-visible:ring-primary-100',
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((opt) => (
                <option key={String(opt.value)} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
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

export default Select;
