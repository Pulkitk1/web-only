import { useEffect, useState } from 'react';

import { msUntilMidnight, todayKey, type DateKey } from '@/utils/date';

/**
 * The device's local date, refreshed when the tab becomes visible again and at local midnight while open
 * (Android `rememberToday()`).
 */
export function useToday(): DateKey {
  const [today, setToday] = useState<DateKey>(todayKey);

  useEffect(() => {
    const timer = setTimeout(() => setToday(todayKey()), msUntilMidnight() + 500);
    return () => clearTimeout(timer);
  }, [today]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setToday(todayKey());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return today;
}
