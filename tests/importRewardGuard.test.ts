/**
 * Phase 10.1: an imported habit carries `rewardsIgnoredThrough` (the import date). Through and including it, the habit neither earns a reward
 * nor takes one away; from the next day on it counts normally; habits without the field behave exactly as before. The Kotlin tests
 * (`ImportedRewardProtectionTest.kt`) assert the same cases and read the same document.
 */
import { describe, expect, it } from 'vitest';

import { mapHabit } from '@/domain/cloudMapping';
import { guestImportEnabled } from '@/services/guestImportFlag';
import { planRewards } from '@/domain/ledger';
import type { RewardRecord } from '@/domain/rewards';
import { countsForRewards, scheduleOf, type HabitSchedule } from '@/domain/schedule';
import { createRewardReconciler } from '@/services/cloudRewards';
import { addDays } from '@/utils/date';
import { range, sched } from './helpers';

const TODAY = '2026-11-23';
const FROM = '2026-11-01';
const CUTOFF = '2026-11-21'; // the import date

const imported = (id: string, completed: Iterable<string>, through = CUTOFF, createdDate = '2026-10-01'): HabitSchedule => ({ ...sched(id, completed, [], { createdDate }), rewardsIgnoredThrough: through });
const legacy = (id: string, completed: Iterable<string>, createdDate = '2026-10-01'): HabitSchedule => sched(id, completed, [], { createdDate });

const active = (id: string, date: string): RewardRecord => ({ id, active: true, cycle: 1, amount: 1, type: 'daily_completion', date });

/** `planRewards` lists every window day as a reversal candidate; the ledger only acts on rewards that are actually in effect. */
const effective = (plan: { grants: { id: string }[]; reversals: string[] }, rewards: Record<string, RewardRecord> = {}) => ({
  grants: plan.grants.map((g) => g.id),
  reversals: plan.reversals.filter((id) => rewards[id]?.active),
});
const dailyIds = (ids: string[]) => ids.filter((i) => i.startsWith('daily_'));

describe('imported dates before the cutoff', () => {
  it('earn no daily reward, which the same completions would earn without the field', () => {
    expect(planRewards({}, [legacy('imp', range(FROM, 9))], CUTOFF).grants).toHaveLength(9);
    expect(effective(planRewards({}, [imported('imp', range(FROM, 9))], CUTOFF))).toEqual({ grants: [], reversals: [] });
  });

  it('earn no milestone: one reached on an imported day pays nothing, where legacy pays it', () => {
    const run = range(FROM, 22); // the 15th counted day is Nov 15, an imported day
    expect(planRewards({}, [legacy('imp', run)], '2026-11-22').grants.some((g) => g.milestone === 15)).toBe(true);
    expect(planRewards({}, [imported('imp', run, '2026-11-22')], '2026-11-22').grants.some((g) => g.milestone !== undefined)).toBe(false);
  });
});

describe('the import date itself and the days after it', () => {
  it('the import date is ignored; the next day counts normally', () => {
    const habit = imported('imp', range(FROM, 22)); // checked Nov 1..22
    expect(planRewards({}, [habit], CUTOFF).grants).toEqual([]); // the cutoff day itself earns nothing
    expect(planRewards({}, [habit], '2026-11-22').grants.map((g) => g.id)).toEqual(['daily_2026-11-22']); // the first day after it pays as usual
  });

  it('countsForRewards is inclusive of the cutoff', () => {
    const h = imported('imp', []);
    expect(countsForRewards(h, '2026-11-20')).toBe(false);
    expect(countsForRewards(h, CUTOFF)).toBe(false);
    expect(countsForRewards(h, addDays(CUTOFF, 1))).toBe(true);
  });

  it('an unchecked imported habit blocks a day after the cutoff as any habit does', () => {
    const e1 = legacy('e1', ['2026-11-22']);
    expect(planRewards({}, [e1, imported('imp', [])], '2026-11-22').grants).toEqual([]);
    expect(planRewards({}, [e1, imported('imp', ['2026-11-22'])], '2026-11-22').grants.map((g) => g.id)).toEqual(['daily_2026-11-22']);
  });

  it('a milestone reached after the cutoff pays as usual', () => {
    const later = imported('imp', range('2026-11-16', 15), '2026-11-22', '2026-11-16'); // imported 16..22, the user keeps going: day 15 is Nov 30
    const grants = planRewards({}, [later], '2026-11-30').grants.filter((g) => g.milestone === 15);
    expect(grants).toHaveLength(1);
    expect(grants[0].date).toBe('2026-11-30');
  });
});

describe('existing rewards are never reversed, other habits are unaffected', () => {
  it('an imported habit that was active but unchecked does not make an earned daily reward ineligible', () => {
    const existing = legacy('e1', range(FROM, 20));
    const rewards = Object.fromEntries(range(FROM, 20).map((d) => [`daily_${d}`, active(`daily_${d}`, d)]));
    // legacy behaviour: the unchecked habit blocks every day, so each reward in effect would be reversed
    expect(effective(planRewards(rewards, [existing, legacy('imp', [])], CUTOFF), rewards).reversals).toHaveLength(20);
    // with the cutoff: nothing is reversed and no new daily reward appears (the existing habit's own milestone is its own business)
    const guarded = effective(planRewards(rewards, [existing, imported('imp', [])], CUTOFF), rewards);
    expect(guarded.reversals).toEqual([]);
    expect(dailyIds(guarded.grants)).toEqual([]);
  });

  it('mixed habits: until the cutoff a day is decided by the non-imported habits alone', () => {
    const plan = planRewards({}, [legacy('e1', ['2026-11-05']), imported('imp', range(FROM, 20))], CUTOFF);
    expect(dailyIds(plan.grants.map((g) => g.id))).toEqual(['daily_2026-11-05']);
  });

  it('other habits earn exactly what they did before', () => {
    const e1 = legacy('e1', range(FROM, 5));
    expect(planRewards({}, [e1, imported('imp', range(FROM, 5))], CUTOFF).grants.map((g) => g.id)).toEqual(planRewards({}, [e1], CUTOFF).grants.map((g) => g.id));
  });

  it('a reward already in effect for an imported habit is never touched by the field', () => {
    // a milestone recorded earlier keeps its id and amount, whatever the cutoff says
    const rec: RewardRecord = { id: 'milestone_imp_15_2026-11-01', active: true, cycle: 1, amount: 5, type: 'streak_milestone', date: '2026-11-15', habitId: 'imp', milestone: 15 };
    const plan = planRewards({ [rec.id]: rec }, [imported('imp', range(FROM, 22), '2026-11-22')], '2026-11-22');
    expect(plan.grants.some((g) => g.id === rec.id)).toBe(false); // not paid again
    expect(plan.reversals).not.toContain(rec.id); // and not reversed: it stays in effect with its id and amount
  });
});

describe('the reconciler', () => {
  it('makes no ledger call for imported history', async () => {
    const calls: string[] = [];
    const ledger = {
      grantReward: async (g: { id: string }) => (calls.push(`grant ${g.id}`), { kind: 'duplicate' as const }),
      revokeReward: async (id: string) => (calls.push(`revoke ${id}`), { kind: 'duplicate' as const }),
    };
    const rec = createRewardReconciler(ledger as never);
    const none = () => false; // nothing recorded in the ledger, as in a fresh account
    expect(await rec.reconcile({ active: {}, schedules: [imported('imp', range(FROM, 20))], today: CUTOFF, hasLedgerEntry: none })).toBeNull();
    expect(calls).toEqual([]);
    await rec.reconcile({ active: {}, schedules: [legacy('imp', range(FROM, 20))], today: CUTOFF, hasLedgerEntry: none }); // sanity: a legacy habit would grant
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('both platforms read the same marker', () => {
  // The same imported-habit document as ImportedRewardProtectionTest.kt (`importedDocument`).
  const doc = {
    id: 'walk-m1a2b3c4d',
    data: { name: 'Evening Walk', createdDate: '2026-10-15', completedDates: ['2026-11-01', '2026-11-02'], restDays: [], rewardsIgnoredThrough: '2026-11-21', migratedFrom: '1a2b3c4d-0000:local-1' },
  };

  it('the converter reads it, and the schedule carries it', () => {
    const habit = mapHabit(doc, {})!.habit;
    expect(habit.rewardsIgnoredThrough).toBe('2026-11-21');
    expect(scheduleOf(habit, []).rewardsIgnoredThrough).toBe('2026-11-21');
  });

  it('a legacy document has no marker, and neither has its schedule', () => {
    const habit = mapHabit({ id: 'a', data: { name: 'Old', createdDate: '2026-10-01' } }, {})!.habit;
    expect('rewardsIgnoredThrough' in habit).toBe(false);
    expect('rewardsIgnoredThrough' in scheduleOf(habit, [])).toBe(false);
  });

  it('a blank, malformed or non-text marker reads as missing', () => {
    for (const bad of ['', '  ', 'not-a-date', '2026-13-40', 20261121, null]) {
      expect('rewardsIgnoredThrough' in mapHabit({ id: 'a', data: { name: 'x', rewardsIgnoredThrough: bad } }, {})!.habit).toBe(false);
    }
  });
});

describe('rollout gate', () => {
  it('is on in development builds, and in production only when explicitly enabled', () => {
    expect(guestImportEnabled({ dev: true })).toBe(true);
    expect(guestImportEnabled({ dev: false })).toBe(false);
    expect(guestImportEnabled({ dev: false, flag: undefined })).toBe(false);
    expect(guestImportEnabled({ dev: false, flag: 'false' })).toBe(false);
    expect(guestImportEnabled({ dev: false, flag: 'true' })).toBe(true);
  });
});
