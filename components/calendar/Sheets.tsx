/**
 * The Calendar's sheets (android HabitCalendarScreen.kt): `FreezeSheet`, `CompletedDaySheet`, `DayNoteSection`,
 * `PastMonthBanner` and `ScheduleSheet`. Copy, titles and button labels are the Kotlin strings.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { RestDayChip } from '@/components/habit/RestDayChip';
import { FieldLabel, GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet } from '@/components/ui/overlays';
import { FREEZE_ELIGIBILITY_MESSAGE, MAX_FREEZE_APPLICATIONS_PER_MONTH, STREAK_FREEZE_RECOVERY_DAYS } from '@/domain/freeze';
import { NOTE_MAX_LENGTH, normalizeNote } from '@/domain/notes';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, type HabitView } from '@/store/AppStore';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';
import { addDays, monthKeyOf, todayKey, WEEKDAYS, type DateKey } from '@/utils/date';
import { formatLongDate, monthName } from './shared';

function SheetTitle({ children, onDismiss }: { children: string; onDismiss: () => void }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 12 }}>
      <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>{children}</Text>
      <CloseButton onPress={onDismiss} />
    </View>
  );
}

/** Informational banner for a day in an earlier calendar month: it counts toward streaks but earns no coins. */
export function PastMonthBanner({ date }: { date: DateKey }) {
  const { t, isDark } = useTheme();
  if (monthKeyOf(date) >= monthKeyOf(todayKey())) return null;
  const warm = '#FF8A3D';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14, borderRadius: 14, backgroundColor: withAlpha(warm, isDark ? 0.1 : 0.12), borderWidth: 1, borderColor: withAlpha(warm, 0.28), paddingHorizontal: 12, paddingVertical: 10 }}>
      <View style={{ marginTop: 1 }}>
        <Icon name="info-outline" size={18} color={warm} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>Past month activity</Text>
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 2 }}>Your progress counts toward streaks, but coin rewards aren&apos;t available for previous months.</Text>
      </View>
    </View>
  );
}

/**
 * "Add a Note (Optional)": collapsed to one row until tapped; shows a saved note with Edit and Delete. Saving or deleting
 * only touches the note. `onSave` reports whether the write succeeded so the draft is kept if it didn't; deleting is
 * confirmed by the screen (`onRequestDelete`).
 */
export function DayNoteSection({ dayKey, saved, onSave, onRequestDelete, placeholder = 'Why did you miss this habit?' }: { dayKey: string; saved: string | null; onSave: (text: string) => boolean; onRequestDelete: () => void; placeholder?: string }) {
  const { t } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved ?? '');
  useEffect(() => {
    setEditing(false);
    setDraft(saved ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, saved === null]);
  const canSave = normalizeNote(draft) !== null && draft.trim() !== saved;

  return (
    <View style={{ marginBottom: 16, borderRadius: 16, backgroundColor: t.option, borderWidth: 1, borderColor: t.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={saved === null ? 'Add a Note (Optional)' : 'View/Edit Note'}
        disabled={saved !== null}
        onPress={() => {
          if (editing) setEditing(false);
          else {
            setDraft('');
            setEditing(true);
          }
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 }}
      >
        <Icon name="note-alt" size={18} color={Brand.CalendarYellow} />
        <Text style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: '600' }}>{saved === null ? 'Add a Note (Optional)' : 'View/Edit Note'}</Text>
        {saved === null && <Icon name={editing ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={t.muted} />}
      </Pressable>

      {saved !== null && !editing && (
        <>
          <Text style={{ color: t.text, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingBottom: 4 }}>{saved}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDraft(saved);
                setEditing(true);
              }}
              style={{ paddingHorizontal: 12, paddingVertical: 10 }}
            >
              <Text style={{ color: Brand.Blue, fontWeight: '600', fontSize: 14 }}>Edit</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onRequestDelete} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
              <Text style={{ color: Brand.Error, fontWeight: '600', fontSize: 14 }}>Delete</Text>
            </Pressable>
          </View>
        </>
      )}

      {editing && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <TextInput
            multiline
            numberOfLines={3}
            value={draft}
            onChangeText={(v) => setDraft(v.slice(0, NOTE_MAX_LENGTH))}
            placeholder={placeholder}
            placeholderTextColor={t.muted}
            accessibilityLabel="Note"
            style={{ minHeight: 76, maxHeight: 150, backgroundColor: t.field, color: t.text, borderRadius: 12, borderWidth: 1.5, borderColor: t.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, lineHeight: 20, textAlignVertical: 'top', outlineStyle: 'none' } as object}
          />
          <Text style={{ color: draft.length >= NOTE_MAX_LENGTH ? Brand.Error : t.muted, fontSize: 11, textAlign: 'right', marginTop: 4, marginBottom: 8 }}>{`${draft.length}/${NOTE_MAX_LENGTH}`}</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {/* Cancel discards the draft only; a saved note stays exactly as it was. */}
            <View style={{ flex: 1 }}>
              <GhostButton
                text="Cancel"
                onPress={() => {
                  setDraft(saved ?? '');
                  setEditing(false);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <GradientButton text="Save Note" onPress={() => canSave && onSave(draft) && setEditing(false)} colors={[Brand.Gold, `${Brand.Gold}CC`]} contentColor={Brand.GoldInk} enabled={canSave} verticalPadding={12} fontSize={14} radius={14} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: t.muted, fontSize: 14 }}>{label}</Text>
      {children}
    </View>
  );
}

export type NoteHooks = {
  noteFor: string | null;
  onSave: (text: string) => boolean;
  onRequestDelete: () => void;
};

/** A completed day (active or rest): shows the day and its optional note. Only the note can change here. */
export function CompletedDaySheet({ habit, date, rest, note, onDismiss }: { habit: HabitView; date: DateKey | null; rest: boolean; note: NoteHooks; onDismiss: () => void }) {
  const { t } = useTheme();
  if (!date) return null;
  return (
    <BottomSheet visible onDismiss={onDismiss}>
      <SheetTitle onDismiss={onDismiss}>{rest ? '✅ Completed on a Rest Day' : '✅ Completed'}</SheetTitle>
      <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20, marginBottom: 16 }}>{`${habit.name} · ${formatLongDate(date)}`}</Text>
      <PastMonthBanner date={date} />
      <DayNoteSection dayKey={`${habit.id}_${date}`} saved={note.noteFor} onSave={note.onSave} onRequestDelete={note.onRequestDelete} placeholder="How did it go? Anything worth remembering?" />
      <GhostButton text="Close" onPress={onDismiss} />
    </BottomSheet>
  );
}

/**
 * Confirms using one purchased Streak Freeze on a missed day. Ineligible days show why, with no active Use button;
 * with no freezes owned it points to the Wallet instead.
 */
export function FreezeSheet({ habit, date, note, onDismiss, onUse, onWallet }: { habit: HabitView; date: DateKey | null; note: NoteHooks; onDismiss: () => void; onUse: (d: DateKey) => void; onWallet: () => void }) {
  const { t } = useTheme();
  const store = useAppStore();
  if (!date) return null;
  const d = date;
  const eligibility = store.freezeEligibility(habit, d);
  const usedThisMonth = store.freezesUsedIn(monthKeyOf(d));
  const monthFull = usedThisMonth >= MAX_FREEZE_APPLICATIONS_PER_MONTH;
  const owned = store.freezesOwned;
  // Frozen days open this sheet too (to view or add a note); there is nothing to apply on them.
  const frozen = eligibility === 'AlreadyFrozen';
  const canApply = eligibility === 'Eligible' && !monthFull && owned > 0;
  const noFreezes = eligibility === 'Eligible' && !monthFull && owned <= 0;
  const dateLabel = formatLongDate(d);
  const message = FREEZE_ELIGIBILITY_MESSAGE[eligibility];

  let body: string;
  if (frozen) body = `${habit.name} · ${dateLabel}\n${message}`;
  else if (noFreezes) body = 'Purchase a freeze from your Wallet to protect eligible missed days.';
  else if (canApply) body = `You missed ${habit.name} on ${dateLabel}.\nUse 1 Streak Freeze to protect your streak.`;
  else if (monthFull && eligibility === 'Eligible') body = `You've used ${MAX_FREEZE_APPLICATIONS_PER_MONTH}/${MAX_FREEZE_APPLICATIONS_PER_MONTH} Streak Freezes for ${monthName(monthKeyOf(d))}.`;
  else if (eligibility === 'NoStreak') {
    // Name the last active day before this one, which is where the streak actually ended.
    let prev: DateKey | null = null;
    for (let i = 1; i <= 7; i++) {
      const c = addDays(d, -i);
      if (!store.isRestDay(habit, c)) {
        prev = c;
        break;
      }
    }
    const prevLabel = prev ? formatLongDate(prev).replace(/, \d{4}$/, '') : null;
    body = `${habit.name} · ${dateLabel}\n${message}` + (prevLabel ? `\nYour streak ended because ${prevLabel} wasn't completed. Double-tap ${prevLabel} to mark it done if you did it, then try again.` : '');
  } else body = `${habit.name} · ${dateLabel}\n${message}`;

  const title = frozen ? 'Streak Freeze Used' : noFreezes ? 'No Streak Freezes Available' : canApply ? 'Protect Your Streak' : "Can't Use a Freeze";

  return (
    <BottomSheet visible onDismiss={onDismiss}>
      <SheetTitle onDismiss={onDismiss}>{title}</SheetTitle>
      <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20, marginBottom: 16 }}>{body}</Text>
      <PastMonthBanner date={d} />
      <View style={{ marginBottom: 16, borderRadius: 16, backgroundColor: t.option, borderWidth: 1, borderColor: t.border, padding: 16 }}>
        <DetailRow label="Available Freezes">
          <Text style={{ color: owned > 0 ? Brand.Blue : Brand.Error, fontSize: 14, fontWeight: '700' }}>{`❄️ ${owned}`}</Text>
        </DetailRow>
        <View style={{ height: 1, backgroundColor: t.border, marginVertical: 12 }} />
        <DetailRow label="Used this month">
          <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{`${usedThisMonth}/${MAX_FREEZE_APPLICATIONS_PER_MONTH}`}</Text>
        </DetailRow>
      </View>
      <Text style={{ color: withAlpha(Brand.Blue, 0.75), fontSize: 11, marginBottom: 16 }}>
        {`A freeze keeps your streak going through one missed day. It doesn't count as a completed day, and only misses from the last ${STREAK_FREEZE_RECOVERY_DAYS} days can be protected.`}
      </Text>
      {store.canHaveNote(habit, d) && <DayNoteSection dayKey={`${habit.id}_${d}`} saved={note.noteFor} onSave={note.onSave} onRequestDelete={note.onRequestDelete} />}
      {frozen ? null : noFreezes ? (
        <GradientButton text="🪙  Go to Wallet" onPress={onWallet} colors={[Brand.Gold, `${Brand.Gold}CC`]} contentColor={Brand.GoldInk} />
      ) : (
        <GradientButton text={canApply ? '❄️  Use Freeze' : 'Not Available'} onPress={() => canApply && onUse(d)} colors={[Brand.Blue, Brand.BlueAlt]} contentColor="#FFFFFF" enabled={canApply} />
      )}
      <GhostButton text={frozen ? 'Close' : 'Cancel'} onPress={onDismiss} style={{ marginTop: 8 }} />
    </BottomSheet>
  );
}

/**
 * "Edit Schedule" (Kotlin's own calendar sheet): 5/6/7 days a week plus the rest days. The change applies from tomorrow;
 * past days keep the schedule they had.
 */
export function ScheduleSheet({ visible, currentDays, currentRest, onDismiss, onSave }: { visible: boolean; currentDays: number; currentRest: string[]; onDismiss: () => void; onSave: (days: number, rest: string[]) => void }) {
  const { t } = useTheme();
  const [dpw, setDpw] = useState(currentDays);
  const [rest, setRest] = useState<string[]>(currentRest);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (visible) {
      setDpw(currentDays);
      setRest(currentRest);
      setError(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(false), 2000);
    return () => clearTimeout(id);
  }, [error]);
  const maxRest = 7 - dpw;
  const canSave = dpw === 7 || rest.length === maxRest;

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} maxHeightFraction={0.8} scrimAlpha={0.6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 20 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>Edit Schedule</Text>
        <CloseButton onPress={onDismiss} />
      </View>
      <FieldLabel style={{ marginBottom: 2 }}>DAYS PER WEEK</FieldLabel>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
        {[5, 6, 7].map((n) => {
          const sel = dpw === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${n} days per week`}
              accessibilityState={{ selected: sel }}
              onPress={() => {
                setDpw(n);
                setRest((r) => (n === 7 ? [] : r.slice(0, 7 - n)));
              }}
              style={{ flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: sel ? 11 : 12, backgroundColor: sel ? withAlpha(Brand.Green, 0.12) : t.option, borderWidth: sel ? 2 : 1.5, borderColor: sel ? Brand.Green : t.border }}
            >
              <Text style={{ color: sel ? Brand.Green : t.text, fontSize: 14, fontWeight: '700' }}>{`${n}d/wk`}</Text>
            </Pressable>
          );
        })}
      </View>
      {dpw < 7 && (
        <>
          <View style={{ flexDirection: 'row', marginBottom: 10 }}>
            <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.9 }}>REST DAYS</Text>
            <Text style={{ color: rest.length === maxRest ? Brand.Blue : t.muted, fontSize: 11, fontWeight: '600' }}>{`  ${rest.length}/${maxRest} selected`}</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {WEEKDAYS.map((day) => (
              <RestDayChip
                key={day}
                day={day}
                isRest={rest.includes(day)}
                showActiveDot={false}
                onPress={() => {
                  if (rest.includes(day)) {
                    setRest(rest.filter((x) => x !== day));
                    setError(false);
                  } else if (rest.length >= maxRest) setError(true);
                  else {
                    setRest([...rest, day]);
                    setError(false);
                  }
                }}
              />
            ))}
          </View>
          <View style={{ minHeight: 18 }}>{error && <Text style={{ color: Brand.Error, fontSize: 12 }}>{`Max ${maxRest} rest ${maxRest === 1 ? 'day' : 'days'} for ${dpw} days/week.`}</Text>}</View>
          <Text style={{ color: withAlpha(Brand.Blue, 0.75), fontSize: 11, marginTop: 4, marginBottom: 20 }}>Rest days won&apos;t break your streak.</Text>
        </>
      )}
      <GradientButton text="Save Schedule" onPress={() => canSave && onSave(dpw, WEEKDAYS.filter((d) => rest.includes(d)))} colors={[Brand.Blue, Brand.BlueAlt]} contentColor="#FFFFFF" enabled={canSave} />
    </BottomSheet>
  );
}
