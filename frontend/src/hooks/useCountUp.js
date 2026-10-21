import { useEffect, useRef, useState } from 'react';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const numberFormatter = new Intl.NumberFormat('vi-VN');

/**
 * Đếm số từ 0 lên `value` bằng requestAnimationFrame (easeOutCubic).
 *
 * - duration: thời gian đếm, mặc định 800ms.
 * - Mỗi khi `value` đổi, hook đếm lại từ 0.
 * - Người dùng bật prefers-reduced-motion: nhảy thẳng tới giá trị đích.
 *
 * Trả về số nguyên hiện tại đã format theo vi-VN (vd "1.250") dạng chuỗi,
 * sẵn sàng render trực tiếp: const xp = useCountUp(totalXp).
 */
export function useCountUp(value, { duration = 800 } = {}) {
  const target = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [current, setCurrent] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || duration <= 0 || target === 0) {
      setCurrent(target);
      return undefined;
    }

    let cancelled = false;
    const startedAt = performance.now();
    const tick = (now) => {
      if (cancelled) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      setCurrent(Math.round(target * easeOutCubic(progress)));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return numberFormatter.format(current);
}

export default useCountUp;
