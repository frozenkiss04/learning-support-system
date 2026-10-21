/**
 * Flat empty state for the learning path area (no courses yet, or a course
 * without any content). No illustration, no decoration — icon in a bordered
 * square, title, one-line description, optional action.
 *
 * Props:
 * - icon: Lucide icon component
 * - title: string
 * - description: string
 * - action: optional React node (e.g. a retry button)
 */
export default function LearnEmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-16 text-center">
      {Icon && (
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
          <Icon className="h-6 w-6 text-slate-500" aria-hidden="true" />
        </div>
      )}
      <h2 className="mt-4 text-base font-semibold text-slate-900">{title}</h2>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
