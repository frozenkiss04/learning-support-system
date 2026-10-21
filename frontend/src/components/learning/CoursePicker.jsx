import { ChevronDown } from 'lucide-react';

/**
 * Course switcher shown when the learner has more than one published course.
 * Native <select> styled to the design system (flat, slate border, 8px radius).
 *
 * Props:
 * - courses: [{ id, title, level }]
 * - value: selected course id
 * - onChange(courseId: number)
 */
export default function CoursePicker({ courses, value, onChange }) {
  if (!courses || courses.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="course-picker" className="text-sm font-medium text-slate-600">
        Khóa học
      </label>
      <div className="relative">
        <select
          id="course-picker"
          value={value ?? ''}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-10 appearance-none rounded-md border border-slate-200 bg-white pl-3 pr-9 text-sm font-medium text-slate-900 focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700"
        >
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
              {course.level ? ` (${course.level})` : ''}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
