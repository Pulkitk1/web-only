/**
 * Account deletion safety (Phase 11B stage 3, updated in Phase 12A). The `deletionRequested` flag on the profile is what opens ledger deletion
 * and a wallet reset in the Firestore rules (see WEB_SECURITY_AUDIT.md, S-04), so the Web must never set it by accident. Since Phase 12A the Web
 * has ONE deliberate account deletion (Settings > Delete Account: password re-entry, typing DELETE, `domain/accountDeletion.ts`), and exactly one
 * source file may write the flag: `services/firestoreEraser.ts`, reached only through that flow. Every other writer is still barred (below).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCloudData } from '@/domain/cloudMapping';
import { scopedLedgerTransaction } from '@/services/cloudLedger';
import { scopedMigrationBackend, type MigrationBackend } from '@/services/guestMigration';
import { scopedWriter, type DocWriter } from '@/services/habitWriter';
import { scopedReader } from '@/services/cloudRepository';

const root = join(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (['node_modules', 'dist', 'tests', 'scripts', '.expo', 'firebase', '.git'].includes(f) ? [] : statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe('the Web can start an account deletion only through the Delete Account flow', () => {
  const ERASER = 'services/firestoreEraser.ts';
  const mentions = () =>
    walk(root)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /deletionRequested(At)?/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1).replace(/\\/g, '/'));

  it('the flag is mentioned only by the reviewed files: the two readers, the deletion protocol and its one Firestore writer', () => {
    expect(mentions()).toEqual(['domain/accountDeletion.ts', 'domain/cloudMapping.ts', ERASER, 'store/AppStore.tsx']);
  });

  it('only the eraser writes the flag, with a merge of exactly deletionRequested and its time; every other file only reads it or names it', () => {
    for (const f of mentions().filter((m) => m !== ERASER)) {
      const src = readFileSync(join(root, f), 'utf8');
      expect(src, f).not.toMatch(/deletionRequested(At)?\s*:\s*(true|serverTimestamp|SERVER_TIMESTAMP)/);
      expect(src, f).not.toMatch(/deletionRequestedAt/);
      expect(src, f).not.toMatch(/deletionRequested\s*=[^=]/);
    }
    const eraser = readFileSync(join(root, ERASER), 'utf8');
    const writes = eraser.match(/setDoc\([^;]*deletionRequested[^;]*;/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('{ deletionRequested: true, deletionRequestedAt: serverTimestamp() }, { merge: true }');
    expect(eraser).toContain('markDeletionRequested'); // reached only through the DataEraser interface, which only deleteAccountFlow uses
  });

  it('nothing in the UI calls the eraser directly: the only caller of the deletion flow is the session controller', () => {
    const users = walk(root).filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => /\b(lazyEraser|activeEraser|firestoreEraser|createFirestoreEraser|eraseUserData|deleteAccountFlow)\b/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1).replace(/\\/g, '/'));
    expect(users).toEqual(['domain/accountDeletion.ts', 'services/accountEraser.ts', 'services/auth.ts', 'services/firestoreEraser.ts', 'services/sessionController.ts']);
  });

  it('the ledger transaction cannot touch deletionRequested, or any other profile field than the wallet ones', () => {
    const calls: string[] = [];
    const t = scopedLedgerTransaction({ get: async () => null, update: (p) => void calls.push(p), set: (p) => void calls.push(p) }, 'u1');
    expect(() => t.update('users/u1', { deletionRequested: true })).toThrow(/Refusing to update field deletionRequested/);
    expect(() => t.update('users/u1', { deletionRequestedAt: 1 })).toThrow(/Refusing/);
    expect(() => t.update('users/u1', { isAdmin: true })).toThrow(/Refusing/);
    expect(() => t.update('users/u1', { coins: 1, lastTransactionId: 'x', pendingAdjustment: 0, freezesOwned: 0, updatedAt: 1, welcomeFreezePending: false })).not.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('the habit writer cannot write the profile document at all', () => {
    const w: DocWriter = { newId: () => 'x', set: async () => undefined, update: async () => undefined, deleteMany: async () => undefined, batch: async () => undefined };
    const s = scopedWriter(w, 'u1');
    expect(() => s.set('users/u1', { deletionRequested: true })).toThrow(/Refusing to write/);
    expect(() => s.update('users/u1', { deletionRequested: true })).toThrow(/Refusing to update/);
    expect(() => s.deleteMany(['users/u1'])).toThrow(/Refusing to delete/);
    expect(() => s.deleteMany(['users/u1/walletTransactions/x'])).toThrow(/Refusing to delete/);
    expect(() => s.batch([{ kind: 'update', path: 'users/u1', fields: { deletionRequested: true } }])).toThrow(/Refusing/);
  });

  it('the guest import backend cannot write the profile in a batch (it only creates a missing one, in a transaction)', () => {
    const b: MigrationBackend = { ensureProfile: async () => 'exists', getDoc: async () => null, listDocs: async () => [], setMany: async () => undefined };
    const s = scopedMigrationBackend(b, 'u1');
    expect(() => s.setMany([{ path: 'users/u1', fields: { deletionRequested: true } }])).toThrow(/Refusing to write/);
    expect(() => s.setMany([{ path: 'users/u1/walletTransactions/x', fields: {} }])).toThrow(/Refusing to write/);
  });

  it('the reader cannot leave the signed-in user', () => {
    const r = scopedReader({ getDoc: async () => null, listDocs: async () => [] }, 'u1');
    expect(() => r.getDoc('users/u2')).toThrow(/Refusing to read/);
  });

  it('a profile marked for deletion is read as such (the Web shows it and stops wallet changes), and an ordinary one is not', () => {
    const data = (user: Record<string, unknown>) => buildCloudData({ uid: 'u1', user: { id: 'u1', data: user }, habits: [], transactions: [], rewards: [], freezes: [], freezeMonths: [], notes: [] });
    expect(data({ coins: 5, deletionRequested: true }).profile?.deletionRequested).toBe(true);
    expect(data({ coins: 5 }).profile?.deletionRequested).toBe(false);
    expect(data({ coins: 5, deletionRequested: 'true' }).profile?.deletionRequested).toBe(false); // only a real boolean counts
  });
});
