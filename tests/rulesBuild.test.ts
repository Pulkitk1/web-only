/**
 * The staged rule sets are GENERATED (scripts/build-rules.mjs) from shared pieces. These tests fail if a committed file is stale, and pin the
 * structural promises of the staging: Part A holds only wallet and path changes, Part B only document validation, and both leave everything
 * they do not own exactly as the rules in force have it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildRules, OUTPUTS } from '../scripts/build-rules.mjs';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const current = readFileSync(join(root, 'firebase', 'rules', 'android-baseline.rules'), 'utf8'); // a copy of the Android app's firestore.rules
const A = read('firebase/firestore.rules');
const B = read('firebase/rules/part-b.rules');
const AB = read('firebase/rules/combined.rules');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|$)/.test(l)).map((l) => l.trim());

describe('generated rule sets', () => {
  it('every committed file equals what the generator produces (run: node scripts/build-rules.mjs)', () => {
    for (const o of OUTPUTS) expect(read(o.path), o.path).toBe(buildRules(o.opts));
  });

  it('the deployment candidate (firebase/firestore.rules) is Part A alone', () => {
    expect(OUTPUTS[0]).toMatchObject({ path: 'firebase/firestore.rules', opts: { a: true, b: false } });
    expect(A).toMatch(/PART A: WALLET INTEGRITY/);
    expect(B).toMatch(/PART B: HABIT AND DOCUMENT VALIDATION/);
    expect(B).toMatch(/NOT a deployment candidate yet/);
  });

  it('Part A contains no habit, completion or note validation, and does not touch what Part B owns', () => {
    for (const forbidden of ['validHabit', 'validCompletion', 'dateKey(', 'hasOnly([\'habitId\', \'date\', \'text\'']) expect(A).not.toContain(forbidden);
    // the dayNotes block is exactly the one in force
    const notesIn = (s: string) => code(s.slice(s.indexOf('match /dayNotes/'))).slice(0, 8).join('\n');
    expect(notesIn(A)).toBe(notesIn(current));
  });

  it('Part B contains no wallet, profile or ledger change: those blocks are exactly the ones in force', () => {
    for (const forbidden of ['entryShape', 'profileUpdateOk', 'profileCreateOk', 'freezePath', 'monthPath']) expect(B).not.toContain(forbidden);
    const walletIn = (s: string) => code(s.slice(s.indexOf('match /walletTransactions/'), s.indexOf('    // Feedback')))
      .filter((l) => !l.startsWith('//')).join('\n');
    expect(walletIn(B)).toBe(walletIn(current));
    expect(code(B).filter((l) => l.startsWith('allow update: if isOwner() && (walletUnchanged()')).length).toBe(1);
  });

  it('the combined set is exactly A and B together: it holds every part and neither part loses anything', () => {
    for (const marker of ['entryShape', 'profileCreateOk', 'validHabit', 'validCompletion']) expect(AB).toContain(marker);
    const lines = new Set(code(AB));
    for (const l of code(A).filter((x) => !x.startsWith('match /habits') && !x.startsWith('allow read, write') && !x.startsWith('allow read, delete'))) expect(lines.has(l), `A line missing from combined: ${l}`).toBe(true);
    for (const l of code(B).filter((x) => !x.startsWith('match /todos') && !x.includes('walletUnchanged') && !x.includes('allow create: if isOwner() && request.resource.data.get(\'coins\'') && !x.startsWith('allow update: if isOwner() && (walletUnchanged')))
      if (/validHabit|validCompletion|dateKey|dayNotes|hasOnly\(\['habitId'/.test(l)) expect(lines.has(l), `B line missing from combined: ${l}`).toBe(true);
  });

  it('no staged set keeps the open catch-all below a habit, and the rules in force still have it', () => {
    expect(current).toContain('{rest=**}');
    for (const s of [A, B, AB]) expect(code(s).join(' ')).not.toContain('{rest=**}');
  });

  it('feedback is NOT granted by any staged set (denied by default, as in production today); ownership is untouched', () => {
    for (const s of [A, B, AB]) {
      expect(code(s).join('\n')).not.toContain('match /feedback/');
      expect(s).toContain('NOT granted here');
      expect(s).toContain('function isOwner() { return request.auth != null && request.auth.uid == userId; }');
    }
    expect(code(current).join('\n')).toContain('match /feedback/'); // the repository copy still has it; only the staged sets leave it out
  });

  it('the price is exactly 20 coins in Part A (the rules in force allow anything from -20 to +20)', () => {
    expect(A).toContain('d.freezeDelta == 1 && d.coinDelta == -20 && pd == 0');
    expect(A).not.toContain('in [-20, -10]');
    expect(AB).toContain('d.coinDelta == -20 && pd == 0');
  });
});
