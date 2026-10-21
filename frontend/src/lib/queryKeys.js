/**
 * Central TanStack Query keys. Use these everywhere instead of ad-hoc arrays
 * so invalidations stay consistent across pages.
 */
export const queryKeys = {
  auth: {
    me: ["auth", "me"],
  },
  courses: {
    all: ["courses"],
    list: ["courses", "list"],
    detail: (courseId) => ["courses", "detail", courseId],
    path: (courseId) => ["courses", "path", courseId],
  },
  lessons: {
    detail: (lessonId) => ["lessons", "detail", lessonId],
  },
  leaderboard: ["leaderboard"],
  admin: {
    stats: ["admin", "stats"],
    users: (params = {}) => ["admin", "users", params],
    weakestLessons: ["admin", "lessons", "weakest"],
  },
  ai: {
    sessions: ["ai", "sessions"],
  },
};
