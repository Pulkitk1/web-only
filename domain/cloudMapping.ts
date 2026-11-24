/**
 * Converters from the raw Firestore documents the Android app writes to the web domain models. Pure functions (no
 * Firebase import): `services/cloudRepository.ts` fetches documents, this file interprets them.
 *
 * Every rule below is a port of the Kotlin reader, so a document is understood the same way on both platforms:
 *   - habit        `AppViewModel.habitFrom`, `HabitRecordParsing.kt` (`completedDateKeys`, `goal`), `ScheduleHistory.fromFirestore`,
 *                  `HabitReminderRules.kt` (reminder fields), `HabitRepository.observeHabits` (ordering)
 *   - wallet       `WalletRepository.observeWallet` (`coins`, `freezesOwned`, `pendingAdjustment`)
 *   - reward       `WalletRepository.toReward`, `rewardTypeOf`
 *   - freeze       `WalletRepository.observeFreezes`
 *   - note         `FirestoreNoteStore.observeNotes`
 *   - transaction  `FirestoreLedgerRunner.commit` (the fields it writes)
 * Missing or malformed fields fall back to the same defaults Kotlin uses; nothing is invented.
 */
import type { LedgerState, FreezeApplication } from '@/domain/ledger';
import type { NotesByHabit } from '@/domain/notes';
import { rewardTypeOf, type RewardRecord } from '@/domain/rewards';
import { parseKey, type DateKey } from '@/utils/date';
import type { Habit, SchedulePeriod } from '@/types/habit';

export type RawData = Record<string, unknown>;
export type RawDoc = { id: string; data: RawData };

// ─── small readers (Kotlin `as? Type` casts) ─────────────────────────────────

const isObj = (v: unknown): v is RawData => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'bigint' ? Number(v) : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const dateKey = (v: unknown): DateKey | null => {
  const s = str(v);
  return s !== null && parseKey(s) ? s : null;
};
/** Firestore `Timestamp` (has `toMillis`), a plain number, or nothing. */
const millis = (v: unknown): number | null => (isObj(v) && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as unknown as { toMillis(): number }).toMillis() : num(v));

// ─── habit colour: Compose `Color.value.toLong()` ↔ "#RRGGBB" ────────────────

/** Kotlin's fallback when a habit has no colour (`Color.Green`, the first palette entry). */
export const DEFAULT_HABIT_COLOR = '#4ADE80';

/**
 * Android stores `Color.value.toLong()`. For an sRGB colour Compose packs `value = ARGB(32 bits) << 32` with the
 * colour-space id (0 for sRGB) in the low bits, so the 32 low bits are zero and the top 32 are 0xAARRGGBB. Read as a
 * signed Long this is negative for every opaque colour (alpha 0xFF).
 * A 32-bit ARGB shifted left by 32 always has at most 32 significant bits, so it survives the double that Firestore's
 * JS SDK returns without losing precision.
 *
 * Returns null for a value that is not a plain sRGB packing (non-zero low bits, i.e. another colour space or a value
 * not written by Compose), instead of guessing.
 */
export function composeColorToHex(value: unknown): string | null {
  let big: bigint;
  try {
    if (typeof value === 'bigint') big = value;
    else if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) big = BigInt(value);
    else return null;
  } catch {
    return null;
  }
  const u = BigInt.asUintN(64, big);
  if ((u & 0xffffffffn) !== 0n) return null;
  const rgb = Number((u >> 32n) & 0xffffffn);
  return '#' + rgb.toString(16).toUpperCase().padStart(6, '0');
}

/** The reverse (for the later write phase): "#RRGGBB" → the signed Long Android stores for an opaque sRGB colour. */
export function hexToComposeColor(hex: string): number | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const argb = 0xff000000n | BigInt(parseInt(m[1], 16));
  return Number(BigInt.asIntN(64, argb << 32n));
}

// ─── habits ──────────────────────────────────────────────────────────────────

/** Kotlin `HabitReminderRules.parseTime`: "HH:mm" 24-hour, or null. */
const validTime = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s) ? s : null;
};

/** `ScheduleHistory.fromFirestore`: entries without a valid `from` date are dropped; `daysPerWeek` defaults to 7 − rest days. */
export function mapScheduleHistory(raw: unknown): SchedulePeriod[] {
  if (!Array.isArray(raw)) return [];
  const out: SchedulePeriod[] = [];
  for (const e of raw) {
    if (!isObj(e)) continue;
    const from = dateKey(e.from);
    if (from === null) continue;
    const restDays = strList(e.restDays);
    out.push({ from, restDays, daysPerWeek: int(e.daysPerWeek) ?? 7 - restDays.length });
  }
  return out;
}

/**
 * `completedDateKeys`: completion documents are the source of truth; the legacy `completedDates` array covers habits saved
 * before they existed, unless a completion document explicitly unchecks that date.
 */
export function completedDateKeys(data: RawData, completions: Record<DateKey, boolean>): DateKey[] {
  const unchecked = new Set(Object.keys(completions).filter((d) => !completions[d]));
  const checked = Object.keys(completions).filter((d) => completions[d]);
  const legacy = strList(data.completedDates).filter((d) => !unchecked.has(d));
  return [...new Set([...legacy, ...checked])].filter((d) => parseKey(d) !== null).sort();
}

export type CloudHabit = { habit: Habit; sortOrder: number | null; createdAtMs: number | null };

/** `habitFrom`: null when the document has no name (Kotlin skips it). `colorIssue` is set when the colour could not be decoded. */
export function mapHabit(doc: RawDoc, completions: Record<DateKey, boolean>): (CloudHabit & { colorIssue: boolean }) | null {
  const d = doc.data;
  const name = str(d.name);
  if (name === null) return null;
  const hasColor = d.color !== undefined && d.color !== null;
  const hex = hasColor ? composeColorToHex(d.color) : DEFAULT_HABIT_COLOR;
  const goal = str(d.goal);
  const createdDate = str(d.createdDate) ?? '';
  return {
    habit: {
      id: doc.id,
      name,
      color: hex ?? DEFAULT_HABIT_COLOR,
      completedDates: completedDateKeys(d, completions),
      daysPerWeek: int(d.daysPerWeek) ?? 7,
      restDays: strList(d.restDays),
      createdDate,
      scheduleHistory: mapScheduleHistory(d.scheduleHistory),
      archived: d.archived === true,
      // Kotlin: blank (including the "" written when a goal is cleared) and missing both read as no goal.
      goal: goal !== null && goal.trim() !== '' ? goal : null,
      reminderEnabled: d.reminderEnabled === true,
      reminderTime: validTime(d.reminderTime),
      // Only habits imported from a guest's data carry it (`rewardsIgnoredThrough`, a yyyy-MM-dd date); missing, blank or malformed reads as absent.
      ...(typeof d.rewardsIgnoredThrough === 'string' && parseKey(d.rewardsIgnoredThrough) !== null ? { rewardsIgnoredThrough: d.rewardsIgnoredThrough } : {}),
    },
    sortOrder: int(d.sortOrder),
    createdAtMs: millis(d.createdAt),
    colorIssue: hasColor && hex === null,
  };
}

/**
 * `observeHabits` ordering: by `sortOrder` (habits never reordered have none and come first), then by `createdAt`
 * (also nulls first). The sort is stable, so equal keys keep the order they were read in.
 */
export function sortHabits<T extends { sortOrder: number | null; createdAtMs: number | null }>(items: readonly T[]): T[] {
  const cmp = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a - b);
  return [...items].sort((x, y) => cmp(x.sortOrder, y.sortOrder) || cmp(x.createdAtMs, y.createdAtMs));
}

/** Completion subcollection: document id is the date; `completed` defaults to false (Kotlin `getBoolean("completed") ?: false`). */
export function mapCompletions(docs: readonly RawDoc[]): Record<DateKey, boolean> {
  const out: Record<DateKey, boolean> = {};
  for (const c of docs) out[c.id] = c.data.completed === true;
  return out;
}

// ─── user profile and wallet ─────────────────────────────────────────────────

export type CloudProfile = {
  email: string | null;
  displayName: string | null;
  /** Account-level theme, only adopted by Android when the device has no saved choice (not applied here). */
  isDark: boolean | null;
  welcomeFreezePending: boolean;
  deletionRequested: boolean;
  /** Legacy: dates frozen for every habit (`users/{uid}.freezeDates`). */
  legacyFreezeDates: DateKey[];
  lastTransactionId: string | null;
  createdAtMs: number | null;
};

export function mapProfile(data: RawData): CloudProfile {
  return {
    email: str(data.email),
    displayName: str(data.displayName),
    isDark: typeof data.isDark === 'boolean' ? data.isDark : null,
    welcomeFreezePending: data.welcomeFreezePending === true,
    deletionRequested: data.deletionRequested === true,
    legacyFreezeDates: strList(data.freezeDates).filter((d) => parseKey(d) !== null),
    lastTransactionId: str(data.lastTransactionId),
    createdAtMs: millis(data.createdAt),
  };
}

/** `observeWallet`: the wallet is the three counters on the user document; each defaults to 0. */
export function mapWallet(data: RawData) {
  return { coins: int(data.coins) ?? 0, freezesOwned: int(data.freezesOwned) ?? 0, pending: int(data.pendingAdjustment) ?? 0 };
}

/** `toReward`. */
export function mapReward(doc: RawDoc): RewardRecord {
  const d = doc.data;
  const r: RewardRecord = { id: doc.id, active: d.active === true, cycle: int(d.cycle) ?? 1, amount: int(d.amount) ?? 0, type: str(d.type) ?? rewardTypeOf(doc.id) };
  const date = str(d.date);
  const habitId = str(d.habitId);
  const milestone = int(d.milestone);
  if (date !== null) r.date = date;
  if (habitId !== null) r.habitId = habitId;
  if (milestone !== null) r.milestone = milestone;
  return r;
}

/** `observeFreezes`: dropped when the habit id or date is missing/invalid; `paidWith` defaults to "coins". */
export function mapFreeze(doc: RawDoc): (FreezeApplication & { transactionId: string | null }) | null {
  const habitId = str(doc.data.habitId);
  const date = dateKey(doc.data.date);
  if (habitId === null || date === null) return null;
  return { habitId, date, paidWith: str(doc.data.paidWith) ?? 'coins', transactionId: str(doc.data.transactionId) };
}

/** `freezeMonths/{yyyy-MM}.count`. */
export function mapFreezeMonth(doc: RawDoc): { month: string; count: number } | null {
  if (!/^\d{4}-\d{2}$/.test(doc.id)) return null;
  return { month: doc.id, count: int(doc.data.count) ?? 0 };
}

export type CloudTransaction = {
  id: string;
  type: string;
  coinDelta: number;
  freezeDelta: number;
  balanceAfter: number;
  pendingDelta: number;
  date: DateKey | null;
  habitId: string | null;
  milestone: number | null;
  rewardId: string | null;
  createdAtMs: number | null;
};

/** The fields `FirestoreLedgerTxn.commit` writes; absent optional numbers read as 0, like `getLong(...) ?: 0`. */
export function mapTransaction(doc: RawDoc): CloudTransaction {
  const d = doc.data;
  return {
    id: doc.id,
    type: str(d.type) ?? '',
    coinDelta: int(d.coinDelta) ?? 0,
    freezeDelta: int(d.freezeDelta) ?? 0,
    balanceAfter: int(d.balanceAfter) ?? 0,
    pendingDelta: int(d.pendingDelta) ?? 0,
    date: str(d.date),
    habitId: str(d.habitId),
    milestone: int(d.milestone),
    rewardId: str(d.rewardId),
    createdAtMs: millis(d.createdAt),
  };
}

/** `observeNotes`: needs habitId, a valid date and non-blank text. */
export function mapNotes(docs: readonly RawDoc[]): NotesByHabit {
  const out: NotesByHabit = {};
  for (const n of docs) {
    const habitId = str(n.data.habitId);
    const date = dateKey(n.data.date);
    const text = str(n.data.text);
    if (habitId === null || date === null || text === null || text.trim() === '') continue;
    (out[habitId] ??= {})[date] = text;
  }
  return out;
}

// ─── the whole account ───────────────────────────────────────────────────────

export type CloudData = {
  uid: string;
  /** False when `users/{uid}` does not exist (a brand-new or empty account): nothing is created here. */
  profileExists: boolean;
  profile: CloudProfile | null;
  habits: Habit[];
  /** Habits whose colour value could not be decoded (shown in the default colour). */
  colorIssues: string[];
  /** The wallet and its records, in the web ledger shape. Transactions carry the five fields the ledger keeps. */
  ledger: LedgerState;
  /** Full transaction documents, newest first (the web ledger keeps only the balance-relevant subset). */
  transactions: CloudTransaction[];
  freezeMonths: { month: string; count: number }[];
  notes: NotesByHabit;
};

export type CloudInput = {
  uid: string;
  user: RawDoc | null;
  habits: { doc: RawDoc; completions: RawDoc[] }[];
  transactions: RawDoc[];
  rewards: RawDoc[];
  freezes: RawDoc[];
  freezeMonths: RawDoc[];
  notes: RawDoc[];
};

export function buildCloudData(input: CloudInput): CloudData {
  const mapped = input.habits.map(({ doc, completions }) => mapHabit(doc, mapCompletions(completions))).filter((h): h is NonNullable<typeof h> => h !== null);
  const sorted = sortHabits(mapped);
  const transactions = input.transactions.map(mapTransaction).sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0) || (a.id < b.id ? -1 : 1));
  const rewards: Record<string, RewardRecord> = {};
  for (const r of input.rewards.map(mapReward)) rewards[r.id] = r;
  const freezes = input.freezes.map(mapFreeze).filter((f): f is NonNullable<typeof f> => f !== null).map(({ habitId, date, paidWith }) => ({ habitId, date, paidWith }));
  return {
    uid: input.uid,
    profileExists: input.user !== null,
    profile: input.user ? mapProfile(input.user.data) : null,
    habits: sorted.map((h) => h.habit),
    colorIssues: sorted.filter((h) => h.colorIssue).map((h) => h.habit.id),
    ledger: {
      wallet: input.user ? mapWallet(input.user.data) : { coins: 0, freezesOwned: 0, pending: 0 },
      rewards,
      txIds: transactions.map((t) => t.id),
      transactions: transactions.map(({ id, type, coinDelta, freezeDelta, balanceAfter, pendingDelta }) => ({ id, type, coinDelta, freezeDelta, balanceAfter, pendingDelta })),
      freezes,
    },
    transactions,
    freezeMonths: input.freezeMonths.map(mapFreezeMonth).filter((m): m is NonNullable<typeof m> => m !== null).sort((a, b) => (a.month < b.month ? 1 : -1)),
    notes: mapNotes(input.notes),
  };
}
