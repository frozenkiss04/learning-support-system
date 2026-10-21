import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const cn = (...parts) => parts.filter(Boolean).join(' ');

const variants = {
  primary:
    'bg-primary-700 text-white hover:bg-primary-800 active:bg-primary-900 disabled:bg-primary-700',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100',
  outline:
    'bg-transparent text-primary-700 border border-primary-700 hover:bg-primary-50 active:bg-primary-100',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-600',
  link: 'bg-transparent text-primary-700 underline-offset-4 hover:underline shadow-none px-0 h-auto',
};

const sizes = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-10 px-5 text-sm gap-2',
  icon: 'h-9 w-9 p-0',
  'icon-sm': 'h-8 w-8 p-0',
};

/**
 * Button chuẩn doanh nghiệp: phẳng, bo 6px, focus ring rõ.
 * Props: variant (primary|secondary|outline|ghost|danger|link),
 * size (sm|md|lg|icon|icon-sm), loading, disabled, className.
 * Khi loading=true nút tự disabled và hiện spinner.
 */
export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    type = 'button',
    className,
    children,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant] ?? variants.primary,
        sizes[size] ?? sizes.md,
        variant === 'link' && 'shadow-none',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

export default Button;
