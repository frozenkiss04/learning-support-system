const cn = (...parts) => parts.filter(Boolean).join(' ');

const variants = {
  primary: 'bg-primary-50 text-primary-800 border-primary-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  outline: 'bg-white text-slate-700 border-slate-300',
};

const sizes = {
  sm: 'px-1.5 py-0 text-[11px] leading-4',
  md: 'px-2 py-0.5 text-xs leading-4',
};

/**
 * Badge trạng thái nhỏ, phẳng, có viền — không dùng màu nền đậm.
 * variant: primary|slate|success|warning|danger|info|outline
 */
export function Badge({ variant = 'slate', size = 'md', className, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border font-medium',
        variants[variant] ?? variants.slate,
        sizes[size] ?? sizes.md,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export default Badge;
