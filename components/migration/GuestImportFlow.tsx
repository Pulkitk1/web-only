/**
 * The guest-import flow shown to a signed-in account (Phase 10): the choice with a preview, the progress, the result, and the retry.
 * Mounted once per signed-in session by `CloudGate`, after the account's data has loaded. It offers the import on its own only when
 * there is guest data, it hasn't been imported, and the user hasn't already chosen "Start with my existing account" for this account;
 * Settings can always open it (`useGuestImport`) until the guest data has been imported.
 *
 * Nothing is selected by default and nothing is imported without an explicit tap on "Import selected". Closing is not possible while
 * the first choice is open: the user decides (import, or start with the existing account). Coins, rewards and freezes are never imported.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet } from '@/components/ui/overlays';
import { guestPreview, type GuestHabitPreview } from '@/domain/guestImport';
import { useTheme } from '@/hooks/useTheme';
import { appStorage } from '@/services/appStorage';
import { guestImportEnabled } from '@/services/guestImportFlag';
import { createGuestImporter, type GuestData, type ImportReport, type MigrationBackend } from '@/services/guestMigration';
import { migrationStore, type MigrationStep } from '@/services/guestMigrationStore';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';

/** A read-only snapshot of the guest data in this browser, or null. Never writes. */
export function readGuestData(): GuestData | null {
  const r = appStorage.load();
  return r.status === 'ok' ? { habits: r.data.habits, notes: r.data.notes } : null;
}

type Phase =
  | { kind: 'closed' }
  | { kind: 'choose'; manual: boolean }
  | { kind: 'resume'; manual: boolean }
  | { kind: 'running'; step: MigrationStep }
  | { kind: 'done'; report: ImportReport }
  | { kind: 'failed'; message: string };

export type GuestImportControls = {
  /** There is guest data that can still be imported into this account (Settings shows its entry). */
  canImport: boolean;
  /** An earlier import for this account did not finish. */
  pending: boolean;
  open: () => void;
};

const Ctx = createContext<GuestImportControls | null>(null);

/** The import controls, or null outside a signed-in session (a guest has nothing to import). */
export const useGuestImport = () => useContext(Ctx);

const STEP_TEXT: Partial<Record<MigrationStep, string>> = {
  preparing: 'Getting your guest data ready.',
  uploading: 'Uploading habits, history and notes.',
  verifying: 'Checking everything arrived safely.',
};

function Row({ habit, checked, onToggle }: { habit: GuestHabitPreview; checked: boolean; onToggle: () => void }) {
  const { t } = useTheme();
  const detail = [`${habit.checkIns} ${habit.checkIns === 1 ? 'check-in' : 'check-ins'}`, habit.notes > 0 ? `${habit.notes} ${habit.notes === 1 ? 'note' : 'notes'}` : null, habit.archived ? 'Archived' : null, habit.sample ? 'Sample habit' : null]
    .filter(Boolean)
    .join(' · ');
  const blocked = habit.problem !== null;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`Import ${habit.name}`}
      aria-checked={checked}
      aria-disabled={blocked}
      accessibilityState={{ checked, disabled: blocked }}
      onPress={blocked ? undefined : onToggle}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: checked ? Brand.Green : t.border, backgroundColor: checked ? withAlpha(Brand.Green, 0.08) : 'transparent' }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: checked ? Brand.Green : t.muted, backgroundColor: checked ? Brand.Green : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <Icon name="check" size={15} color="#000000" /> : null}
      </View>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: habit.color }} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{habit.name}</Text>
        <Text style={{ color: t.muted, fontSize: 12 }}>{detail}</Text>
        {blocked ? <Text style={{ color: Brand.Amber, fontSize: 12 }}>{`Can't be imported: ${habit.problem}`}</Text> : null}
      </View>
    </Pressable>
  );
}

export function GuestImportProvider({ uid, email, backend, children }: { uid: string; email: string; backend: MigrationBackend; children: ReactNode }) {
  const { t } = useTheme();
  const importer = useMemo(() => createGuestImporter({ backend, store: migrationStore, guest: readGuestData }), [backend]);
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; // an import that ends after sign-out reports nothing; it is safe to resume later
    };
  }, []);

  // `version` re-reads the offer after a change (decision recorded, import finished).
  const offer = useMemo(() => importer.offer(uid), [importer, uid, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const habits = useMemo(() => {
    const g = readGuestData();
    return g ? guestPreview(g.habits, g.notes) : [];
  }, [phase.kind === 'choose' || phase.kind === 'resume']); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingRecord = migrationStore.record(uid);
  const pending = migrationStore.isPendingFor(uid);

  const openFor = useCallback((manual: boolean) => {
    setSelected(new Set()); // never pre-selected
    setPhase(migrationStore.isPendingFor(uid) ? { kind: 'resume', manual } : { kind: 'choose', manual });
  }, [uid]);

  // Offered once per signed-in session, when nothing was decided yet (or an import is waiting to be finished).
  const enabled = guestImportEnabled();
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || !enabled) return;
    offered.current = true;
    if (offer.kind === 'offer' || (offer.kind === 'resume' && !migrationStore.isDeclined(uid))) openFor(false);
  }, [enabled, offer.kind, openFor, uid]);

  const run = useCallback(
    async (ids: readonly string[]) => {
      if (busy.current) return;
      busy.current = true;
      setPhase({ kind: 'running', step: 'preparing' });
      try {
        const report = await importer.migrate(uid, email, ids, (step) => alive.current && step !== 'failed' && step !== 'completed' && setPhase({ kind: 'running', step }));
        if (alive.current) setPhase({ kind: 'done', report });
      } catch (e) {
        if (alive.current) setPhase({ kind: 'failed', message: e instanceof Error ? e.message : "Couldn't finish the import." });
      } finally {
        busy.current = false;
        if (alive.current) setVersion((v) => v + 1);
      }
    },
    [importer, uid, email],
  );

  const startWithExisting = useCallback(() => {
    importer.decline(uid);
    setPhase({ kind: 'closed' });
    setVersion((v) => v + 1);
  }, [importer, uid]);

  const close = useCallback(() => setPhase({ kind: 'closed' }), []);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const controls = useMemo<GuestImportControls>(
    () => ({ canImport: enabled && (offer.kind === 'offer' || offer.kind === 'declined' || offer.kind === 'resume'), pending, open: () => openFor(true) }),
    [enabled, offer.kind, pending, openFor],
  );

  const title = (text: string) => (
    <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginBottom: 8 }}>{text}</Text>
  );
  const body = (text: string, color = t.muted) => <Text style={{ color, fontSize: 13, lineHeight: 19, marginBottom: 10 }}>{text}</Text>;
  const link = (text: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress}><Text style={{ color: Brand.Blue, fontSize: 13, fontWeight: '600' }}>{text}</Text></Pressable>
  );
  const notImported = body('Coins, rewards and streak freezes are not imported. Your wallet and your account’s existing habits stay exactly as they are. Your guest data stays on this device.');

  const resumeNames = pendingRecord ? habits.filter((h) => pendingRecord.selected.includes(h.id)) : [];

  return (
    <Ctx.Provider value={controls}>
      {children}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <BottomSheet visible={phase.kind !== 'closed'} onDismiss={() => (phase.kind === 'choose' && phase.manual) || (phase.kind === 'resume' && phase.manual) ? close() : undefined}>
          {phase.kind === 'choose' && (
            <View style={{ paddingTop: 4 }}>
              {title('Import your guest habits?')}
              {body(`You have ${habits.length} ${habits.length === 1 ? 'habit' : 'habits'} saved on this device as a guest. Tick the ones you want to add to your account.`)}
              <View style={{ borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: withAlpha(Brand.Amber, 0.12), borderWidth: 1, borderColor: withAlpha(Brand.Amber, 0.35) }}>
                <Text style={{ color: t.text, fontSize: 12, lineHeight: 18 }}>
                  Sample habits may be included. The app adds sample habits when it is first opened as a guest, and they can&apos;t always be told apart from your own, so nothing is ticked for you.
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 16, marginBottom: 8 }}>
                {link('Select all', () => setSelected(new Set(habits.filter((h) => h.problem === null).map((h) => h.id))))}
                {link('Clear', () => setSelected(new Set()))}
              </View>
              <View style={{ gap: 8, marginBottom: 14 }}>
                {habits.map((h) => (
                  <Row key={h.id} habit={h} checked={selected.has(h.id)} onToggle={() => toggle(h.id)} />
                ))}
              </View>
              {notImported}
              <GradientButton
                text={selected.size > 0 ? `Import selected (${selected.size})` : 'Import selected'}
                enabled={selected.size > 0}
                onPress={() => void run([...selected])}
                colors={[Brand.Green, withAlpha(Brand.Green, 0.8)]}
                contentColor="#000000"
              />
              <GhostButton text="Start with my existing account" onPress={startWithExisting} style={{ marginTop: 8 }} />
              {phase.manual ? <GhostButton text="Close" onPress={close} bordered={false} style={{ marginTop: 4 }} /> : null}
            </View>
          )}

          {phase.kind === 'resume' && (
            <View style={{ paddingTop: 4 }}>
              {title("Your import didn't finish")}
              {body('An earlier import was interrupted. Some of these habits may already be in your account. Continuing adds only what is missing and never duplicates anything.')}
              <View style={{ gap: 6, marginBottom: 12 }}>
                {resumeNames.map((h) => (
                  <Text key={h.id} style={{ color: t.text, fontSize: 14 }}>{`• ${h.name} (${h.checkIns} ${h.checkIns === 1 ? 'check-in' : 'check-ins'})`}</Text>
                ))}
              </View>
              {notImported}
              <GradientButton text="Continue import" onPress={() => void run(pendingRecord?.selected ?? [])} colors={[Brand.Green, withAlpha(Brand.Green, 0.8)]} contentColor="#000000" />
              <GhostButton text="Start with my existing account" onPress={startWithExisting} style={{ marginTop: 8 }} />
              {phase.manual ? <GhostButton text="Close" onPress={close} bordered={false} style={{ marginTop: 4 }} /> : null}
            </View>
          )}

          {phase.kind === 'running' && (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 18 }} accessibilityLiveRegion="polite">
              <ActivityIndicator accessibilityLabel="Importing" color={Brand.Green} />
              {title('Importing your habits…')}
              {body(STEP_TEXT[phase.step] ?? '')}
              {body('Please keep this tab open.')}
            </View>
          )}

          {phase.kind === 'done' && (
            <View style={{ paddingTop: 4 }}>
              {title('Your habits are now in your account.')}
              {body(
                `${phase.report.habits} ${phase.report.habits === 1 ? 'habit' : 'habits'}, ${phase.report.checkIns} ${phase.report.checkIns === 1 ? 'check-in' : 'check-ins'}${phase.report.notes > 0 ? ` and ${phase.report.notes} ${phase.report.notes === 1 ? 'note' : 'notes'}` : ''} imported.`,
                t.text,
              )}
              {body('Your coins, rewards and streak freezes were not changed. Your guest data is still on this device.')}
              <GradientButton text="Done" onPress={close} colors={[Brand.Green, withAlpha(Brand.Green, 0.8)]} contentColor="#000000" />
            </View>
          )}

          {phase.kind === 'failed' && (
            <View style={{ paddingTop: 4 }}>
              {title("The import didn't finish")}
              <Text accessibilityRole="alert" style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>{phase.message}</Text>
              <GradientButton text="Try again" onPress={() => void run(pendingRecord?.selected ?? [...selected])} colors={[Brand.Green, withAlpha(Brand.Green, 0.8)]} contentColor="#000000" />
              <GhostButton text="Not now" onPress={close} style={{ marginTop: 8 }} />
            </View>
          )}
        </BottomSheet>
      </View>
    </Ctx.Provider>
  );
}
