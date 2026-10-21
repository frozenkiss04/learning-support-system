const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Card phẳng: nền trắng, viền slate-200, bo 8px, tối đa shadow-sm.
 * Dùng các khối con: CardHeader, CardTitle, CardDescription,
 * CardContent, CardFooter. Mọi khối đều nhận className để compose.
 */
export function Card({ className, ...props }) {
  return (
    <div
      className={cn('rounded-lg border border-slate-200 bg-white text-slate-900 shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1 border-b border-slate-100 px-5 py-4', className)} {...props} />;
}

export function CardTitle({ as: Tag = 'h3', className, ...props }) {
  return <Tag className={cn('text-base font-semibold tracking-tight text-slate-900', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-slate-600', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-slate-100 px-5 py-3', className)}
      {...props}
    />
  );
}

export default Card;
