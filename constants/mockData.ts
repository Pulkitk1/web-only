/**
 * SAMPLE DATA for development and the browser tests only. It is NOT used to start a real guest or account (a new user starts empty). All dates are generated relative to today so the demo always looks "live".
 */
import type { Habit } from '@/types/habit';
import { addDays, dayName, isAfter, type DateKey } from '@/utils/date';

/** Every non-rest day from `from` to `to` inclusive, minus any `skip` days. */
function activeDays(from: DateKey, to: DateKey, restDays: string[], skip: DateKey[] = []): DateKey[] {
  const out: DateKey[] = [];
  for (let d = from; !isAfter(d, to); d = addDays(d, 1)) {
    if (!restDays.includes(dayName(d)) && !skip.includes(d)) out.push(d);
  }
  return out;
}

/** `dataOrigin: 'demo'` is the explicit marker that these habits are seeded samples (see `Habit.dataOrigin`). */
const base = { archived: false, goal: null, reminderEnabled: false, reminderTime: null, dataOrigin: 'demo' } as const;

export function buildMockHabits(today: DateKey): Habit[] {
  const t = (n: number) => addDays(today, n);
  const weekdaysOff = ['Sat', 'Sun'];
  return [
    {
      ...base,
      id: 'h1',
      name: 'SQL Practice',
      color: '#4ADE80',
      daysPerWeek: 5,
      restDays: weekdaysOff,
      createdDate: t(-40),
      scheduleHistory: [{ from: t(-40), restDays: weekdaysOff, daysPerWeek: 5 }],
      completedDates: activeDays(t(-30), t(-1), weekdaysOff),
    },
    {
      // Missed t-2 while holding a streak: a Streak Freeze can still protect it.
      ...base,
      id: 'h2',
      name: 'Morning Run',
      color: '#FB923C',
      daysPerWeek: 7,
      restDays: [],
      createdDate: t(-20),
      scheduleHistory: [{ from: t(-20), restDays: [], daysPerWeek: 7 }],
      completedDates: activeDays(t(-12), t(-1), [], [t(-2)]),
    },
    {
      ...base,
      id: 'h3',
      name: 'Read Books',
      color: '#818CF8',
      daysPerWeek: 6,
      restDays: ['Sun'],
      createdDate: t(-25),
      scheduleHistory: [{ from: t(-25), restDays: ['Sun'], daysPerWeek: 6 }],
      completedDates: activeDays(t(-25), t(-1), ['Sun'], [t(-5), t(-4)]),
    },
    {
      // 14 days done in a row: completing today reaches the Day-15 milestone (+5 coins).
      ...base,
      id: 'h4',
      name: 'Meditate',
      color: '#F472B6',
      daysPerWeek: 7,
      restDays: [],
      createdDate: t(-14),
      scheduleHistory: [{ from: t(-14), restDays: [], daysPerWeek: 7 }],
      completedDates: activeDays(t(-14), t(-1), []),
    },
    {
      ...base,
      id: 'h5',
      name: 'Drink Water — 8 glasses a day, every day, no excuses',
      color: '#38BDF8',
      daysPerWeek: 7,
      restDays: [],
      createdDate: t(-20),
      scheduleHistory: [{ from: t(-20), restDays: [], daysPerWeek: 7 }],
      completedDates: [t(-20), t(-18), t(-16), t(-15), t(-13), t(-9), t(-7), t(-6), t(-3), t(-1)],
    },
  ];
}

/** Starting wallet for a brand-new user: 20 coins (Firestore rule), plus the one free welcome freeze. */
export const MOCK_START_COINS = 20;

/**
 * Starting coins for a mock session. A test knob only (the browser tests need a wallet that can be emptied to exercise
 * pending adjustments): `localStorage['consisto_mock_start_coins']` overrides the 20-coin default. It works in DEVELOPMENT builds only:
 * `__DEV__` is false in a production build, so the lookup (and the key) is removed from the shipped bundle. Nothing in the app sets it.
 */
export function mockStartCoins(): number {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return MOCK_START_COINS;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem('consisto_mock_start_coins');
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : MOCK_START_COINS;
  } catch {
    return MOCK_START_COINS;
  }
}

/**
 * DEVELOPMENT ONLY: `localStorage['consisto_seed_demo'] === '1'` makes a brand-new session start with the sample habits instead of empty
 * (the browser tests are written against them). `__DEV__` is false in a production build, so this always returns false there and the
 * sample data is not reachable (verify:build checks the key is absent). Nothing in the app sets it.
 */
export function demoSeedEnabled(): boolean {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('consisto_seed_demo') === '1';
  } catch {
    return false;
  }
}
