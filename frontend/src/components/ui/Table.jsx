const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Bộ Table cho trang quản trị: viền slate-200, header slate-50,
 * hàng hover slate-50, số dùng tabular-nums. Tự cuộn ngang khi chật.
 *
 * Dùng: <Table><TableHeader><TableRow><TableHead/></TableRow></TableHeader>
 *       <TableBody><TableRow><TableCell/></TableRow></TableBody></Table>
 * TableEmpty: hàng trạng thái trống trải đều các cột (prop colSpan).
 */
export function Table({ className, wrapperClassName, ...props }) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm',
        wrapperClassName,
      )}
    >
      <table className={cn('w-full caption-bottom border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }) {
  return <thead className={cn('bg-slate-50', className)} {...props} />;
}

export function TableBody({ className, ...props }) {
  return <tbody className={cn('divide-y divide-slate-100', className)} {...props} />;
}

export function TableFooter({ className, ...props }) {
  return <tfoot className={cn('bg-slate-50 font-medium', className)} {...props} />;
}

export function TableRow({ className, ...props }) {
  return (
    <tr
      className={cn('border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50', className)}
      {...props}
    />
  );
}

export function TableHead({ className, scope = 'col', ...props }) {
  return (
    <th
      scope={scope}
      className={cn(
        'h-10 whitespace-nowrap px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }) {
  return (
    <td className={cn('px-4 py-3 align-middle text-slate-700 tabular-nums', className)} {...props} />
  );
}

export function TableEmpty({ colSpan, message = 'Chưa có dữ liệu.', className }) {
  return (
    <TableRow className={cn('hover:bg-white', className)}>
      <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-slate-500">
        {message}
      </TableCell>
    </TableRow>
  );
}

export default Table;
