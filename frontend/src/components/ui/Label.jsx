const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Label cho form control. Luôn gắn htmlFor với id của input.
 * required=true hiện dấu * đỏ và aria cho screen reader.
 */
export function Label({ htmlFor, required = false, className, children, ...props }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('mb-1.5 block text-sm font-medium text-slate-700', className)}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-0.5 text-red-600" aria-hidden="true">
          *
        </span>
      )}
      {required && <span className="sr-only">(bắt buộc)</span>}
    </label>
  );
}

export default Label;
