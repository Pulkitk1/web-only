import { useEffect, useRef, useState } from 'react';

/** Smoothly animates a number toward `target` over `ms` (ease-in-out), like Compose `animateFloatAsState(tween(ms))`. */
export function useAnimatedNumber(target: number, ms = 500): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const start = Date.now();
    const begin = current.current;
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / ms);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      current.current = begin + (target - begin) * eased;
      setValue(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}
