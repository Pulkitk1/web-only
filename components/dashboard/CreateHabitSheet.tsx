/**
 * New Habit flow (android/.../ui/screens/CreateHabitSheet.kt): Weekly goal -> Rest days -> Create
 * (name, schedule, optional Reminder, colour, optional Goal).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { FieldLabel, GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet } from '@/components/ui/overlays';
import { DEFAULT_REMINDER_TIME } from '@/domain/reminder';
import { canContinueRest, canCreateHabit, isAcceptableRestInput, maxRestDays, nextStepAfterWeekly, parseCustomRest, restCapMessage, stepRestDays, toggleRestDay, WEEKLY_OPTIONS } from '@/domain/weeklyGoal';
import { useTheme } from '@/hooks/useTheme';
import { Brand, HABIT_PALETTE, type PaletteColor } from '@/theme';
import { withAlpha } from '@/utils/color';
import { WEEKDAYS } from '@/utils/date';
import { HabitColorGrid } from '@/components/habit/HabitColorGrid';
import { RestDayChip } from '@/components/habit/RestDayChip';
import { GoalField } from './GoalField';
import { ReminderSection } from './ReminderSection';

type Step = 'weekly' | 'rest' | 'create';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onCreate: (v: { name: string; color: string; daysPerWeek: number; restDays: string[]; goal: string; reminderEnabled: boolean; reminderTime: string }) => void;
};

export function CreateHabitSheet({ visible, onDismiss, onCreate }: Props) {
  const [step, setStep] = useState<Step>('weekly');
  const [daysPerWeek, setDaysPerWeek] = useState<number | null>(null);
  const [restDays, setRestDays] = useState<string[]>([]);
  const [restError, setRestError] = useState(false);
  const [customRest, setCustomRest] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState<PaletteColor>(HABIT_PALETTE[0]);
  const [goal, setGoal] = useState('');
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderTime, setReminderTime] = useState(DEFAULT_REMINDER_TIME);

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setStep('weekly');
    setDaysPerWeek(null);
    setRestDays([]);
    setRestError(false);
    setCustomRest('');
    setName('');
    setColor(HABIT_PALETTE[0]);
    setGoal('');
    setReminderOn(false);
    setReminderTime(DEFAULT_REMINDER_TIME);
  }, [visible]);

  useEffect(() => {
    if (!restError) return;
    const id = setTimeout(() => setRestError(false), 2200);
    return () => clearTimeout(id);
  }, [restError]);

  const maxRest = maxRestDays(daysPerWeek);

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss}>
      {step === 'weekly' && (
        <WeeklyStep
          daysPerWeek={daysPerWeek}
          customRest={customRest}
          onPick={(days) => {
            setDaysPerWeek(days);
            setCustomRest(String(7 - days));
          }}
          onCustomRest={(v) => {
            setCustomRest(v);
            const c = parseCustomRest(v);
            if (c.valid) setDaysPerWeek(c.daysPerWeek);
          }}
          onNext={() => {
            setRestDays([]);
            setStep(nextStepAfterWeekly(daysPerWeek ?? 7));
          }}
          onClose={onDismiss}
        />
      )}
      {step === 'rest' && (
        <RestStep
          maxRest={maxRest}
          daysPerWeek={daysPerWeek}
          restDays={restDays}
          showError={restError}
          onToggle={(day) => {
            const r = toggleRestDay(restDays, day, maxRest);
            setRestDays(r.restDays);
            setRestError(r.error);
          }}
          onContinue={() => canContinueRest(restDays.length, daysPerWeek) && setStep('create')}
          onBack={() => setStep('weekly')}
        />
      )}
      {step === 'create' && (
        <CreateStep
          name={name}
          onName={setName}
          color={color}
          onColor={setColor}
          goal={goal}
          onGoal={setGoal}
          reminderOn={reminderOn}
          reminderTime={reminderTime}
          onReminderOn={setReminderOn}
          onReminderTime={setReminderTime}
          daysPerWeek={daysPerWeek}
          restDays={restDays}
          onEditWeekly={() => setStep('weekly')}
          onEditRest={() => (daysPerWeek ?? 7) < 7 && setStep('rest')}
          onCreate={() =>
            name.trim() &&
            onCreate({ name: name.trim(), color: color.color, daysPerWeek: daysPerWeek ?? 7, restDays, goal, reminderEnabled: reminderOn, reminderTime })
          }
          onClose={onDismiss}
        />
      )}
    </BottomSheet>
  );
}

function SheetHeader({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 20 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.4 }}>{title}</Text>
        {subtitle ? <Text style={{ color: t.muted, fontSize: 13, marginTop: 4 }}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

function Divider({ flex }: { flex?: boolean }) {
  const { t } = useTheme();
  return <View style={{ height: 1, backgroundColor: t.border, ...(flex ? { flex: 1 } : {}) }} />;
}

function StepperButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'More rest days' : 'Fewer rest days'}
      onPress={onPress}
      style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.isDark ? '#1E1E1E' : '#F0F0F0', borderWidth: 1.5, borderColor: t.border }}
    >
      <Text style={{ color: t.text, fontSize: 20, fontWeight: '300' }}>{label}</Text>
    </Pressable>
  );
}

function WeeklyStep(props: {
  daysPerWeek: number | null;
  customRest: string;
  onPick: (d: number) => void;
  onCustomRest: (v: string) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const { daysPerWeek, customRest } = props;
  const parsed = parseInt(customRest, 10);
  const custom = parseCustomRest(customRest);
  const valid = custom.valid;
  return (
    <>
      <SheetHeader title="Weekly goal" subtitle="How many days a week will you do this habit?" trailing={<CloseButton onPress={props.onClose} />} />
      <View style={{ gap: 12, marginBottom: 24 }}>
        {WEEKLY_OPTIONS.map(([days, helper]) => {
          const selected = daysPerWeek === days;
          return (
            <Pressable
              key={days}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => props.onPick(days)}
              style={{
                borderRadius: 16,
                backgroundColor: selected ? withAlpha(Brand.Green, 0.08) : t.option,
                borderWidth: selected ? 2 : 1.5,
                borderColor: selected ? Brand.Green : t.border,
                paddingHorizontal: 18,
                paddingVertical: 16,
              }}
            >
              <Text style={{ color: selected ? Brand.Green : t.text, fontSize: 16, fontWeight: '700' }}>{`${days} days/week`}</Text>
              <Text style={{ color: selected ? withAlpha(Brand.Green, 0.75) : t.muted, fontSize: 13, marginTop: 3 }}>{helper}</Text>
              {selected && (
                <View style={{ position: 'absolute', top: -4, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: Brand.Green, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={14} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
        <Divider flex />
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '500', marginHorizontal: 12 }}>or type a custom amount</Text>
        <Divider flex />
      </View>
      <FieldLabel>NUMBER OF REST DAYS</FieldLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <StepperButton label="−" onPress={() => (parsed || 0) > 0 && props.onCustomRest(String(stepRestDays(parsed || 0, -1)))} />
        <TextInput
          value={customRest}
          onChangeText={(v) => isAcceptableRestInput(v) && props.onCustomRest(v)}
          placeholder="0 – 6"
          placeholderTextColor={`${t.muted}99`}
          keyboardType="number-pad"
          accessibilityLabel="Number of rest days"
          style={{
            flex: 1,
            backgroundColor: t.field,
            color: t.text,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: customRest === '' ? t.border : valid ? withAlpha(Brand.Green, 0.55) : Brand.Error,
            paddingHorizontal: 16,
            paddingVertical: 13,
            fontSize: 18,
            fontWeight: '700',
            textAlign: 'center',
            outlineStyle: 'none',
          } as object}
        />
        <StepperButton label="+" onPress={() => (parsed || 0) < 6 && props.onCustomRest(String(stepRestDays(parsed || 0, 1)))} />
      </View>
      <View style={{ minHeight: 20, marginTop: 6, marginBottom: 20 }}>
        {customRest !== '' &&
          (valid ? (
            <Text style={{ color: Brand.Green, fontSize: 12 }}>
              {custom.valid ? custom.label : ''}
            </Text>
          ) : (
            <Text style={{ color: Brand.Error, fontSize: 12 }}>Enter a number between 0 and 6.</Text>
          ))}
      </View>

      <GradientButton text={daysPerWeek === 7 ? 'Next → Create Habit' : 'Next →'} onPress={props.onNext} colors={[Brand.Green, Brand.GreenAlt]} contentColor={Brand.OnGreen} enabled={daysPerWeek !== null} />
      <View style={{ height: 10 }} />
      <GhostButton text="Cancel" onPress={props.onClose} />
    </>
  );
}

function RestStep(props: { maxRest: number; daysPerWeek: number | null; restDays: string[]; showError: boolean; onToggle: (d: string) => void; onContinue: () => void; onBack: () => void }) {
  const { t } = useTheme();
  const { maxRest, restDays } = props;
  const word = maxRest === 1 ? 'day' : 'days';
  return (
    <>
      <SheetHeader
        title="Choose rest days"
        subtitle={`Pick ${maxRest} rest ${word}`}
        trailing={
          <Text
            style={{
              color: restDays.length === maxRest ? Brand.Blue : t.muted,
              fontSize: 13,
              fontWeight: '700',
              borderRadius: 20,
              backgroundColor: t.closeBg,
              borderWidth: 1,
              borderColor: t.border,
              paddingHorizontal: 12,
              paddingVertical: 6,
              overflow: 'hidden',
            }}
          >
            {`${restDays.length}/${maxRest}`}
          </Text>
        }
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
        {WEEKDAYS.map((day) => (
          <RestDayChip key={day} day={day} isRest={restDays.includes(day)} onPress={() => props.onToggle(day)} />
        ))}
      </View>
      <View style={{ minHeight: 22, marginBottom: 6 }}>
        {props.showError && <Text style={{ color: Brand.Error, fontSize: 12 }}>{restCapMessage(maxRest)}</Text>}
      </View>
      <GradientButton text="Continue →" onPress={props.onContinue} colors={[Brand.Blue, Brand.BlueAlt]} contentColor="#FFFFFF" enabled={canContinueRest(restDays.length, props.daysPerWeek)} />
      <View style={{ height: 10 }} />
      <GhostButton text="← Back" onPress={props.onBack} />
    </>
  );
}

function ScheduleRow({ label, value, valueColor, editable, onPress }: { label: string; value: string; valueColor: string; editable: boolean; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable disabled={!editable} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 }}>
      <Text style={{ flex: 1, color: t.muted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: valueColor, fontSize: 14, fontWeight: '600' }}>{value}</Text>
      {editable && (
        <View style={{ marginLeft: 4 }}>
          <Icon name="keyboard-arrow-right" size={16} color={t.muted} />
        </View>
      )}
    </Pressable>
  );
}

function CreateStep(props: {
  name: string;
  onName: (v: string) => void;
  color: PaletteColor;
  onColor: (c: PaletteColor) => void;
  goal: string;
  onGoal: (v: string) => void;
  reminderOn: boolean;
  reminderTime: string;
  onReminderOn: (on: boolean) => void;
  onReminderTime: (hhmm: string) => void;
  daysPerWeek: number | null;
  restDays: string[];
  onEditWeekly: () => void;
  onEditRest: () => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const { name, color, daysPerWeek, restDays } = props;
  const trimmed = name.trim();
  const hasRest = (daysPerWeek ?? 7) < 7;
  return (
    <>
      <SheetHeader title="New Habit" trailing={<CloseButton onPress={props.onClose} />} />

      <FieldLabel>HABIT NAME</FieldLabel>
      <TextInput
        autoFocus
        value={name}
        onChangeText={props.onName}
        onSubmitEditing={props.onCreate}
        placeholder="e.g. Morning Run, Read Books…"
        placeholderTextColor={`${t.muted}99`}
        returnKeyType="done"
        accessibilityLabel="Habit name"
        style={{
          backgroundColor: t.field,
          color: t.text,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: name ? withAlpha(color.color, 0.5) : t.border,
          paddingHorizontal: 16,
          paddingVertical: 13,
          fontSize: 15,
          fontWeight: '500',
          marginBottom: 20,
          outlineStyle: 'none',
        } as object}
      />

      {trimmed !== '' && (
        <>
          <FieldLabel>PREVIEW</FieldLabel>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              marginBottom: 20,
              borderRadius: 16,
              backgroundColor: withAlpha(color.color, 0.12),
              borderWidth: 1,
              borderColor: withAlpha(color.color, 0.3),
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.color }} />
            <Text numberOfLines={1} style={{ flex: 1, color: color.color, fontSize: 15, fontWeight: '700' }}>
              {name}
            </Text>
            <StreakBadge streak={0} />
          </View>
        </>
      )}

      <FieldLabel>SCHEDULE</FieldLabel>
      <View style={{ borderRadius: 16, backgroundColor: t.isDark ? '#1E1E1E' : '#FFFFFF', borderWidth: 1, borderColor: t.border }}>
        <ScheduleRow label="Days per week" value={daysPerWeek ? `${daysPerWeek} days/week` : 'Not set'} valueColor={Brand.Green} editable onPress={props.onEditWeekly} />
        <Divider />
        <ScheduleRow
          label="Rest days"
          value={daysPerWeek === 7 ? 'None' : restDays.length ? restDays.join(', ') : 'Not set'}
          valueColor={Brand.Blue}
          editable={hasRest}
          onPress={props.onEditRest}
        />
      </View>
      <Text style={{ color: withAlpha(Brand.Blue, 0.75), fontSize: 11, marginTop: 6, marginBottom: 20 }}>Rest days won't break your streak.</Text>

      {/* Optional: each habit has its own reminder, off by default. */}
      <FieldLabel>REMINDER</FieldLabel>
      <ReminderSection enabled={props.reminderOn} time={props.reminderTime} onEnabled={props.onReminderOn} onTime={props.onReminderTime} accent={color.color} />
      <View style={{ height: 20 }} />

      <FieldLabel style={{ marginBottom: 2 }}>COLOUR</FieldLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <View style={{ width: 13, height: 13, borderRadius: 4, backgroundColor: color.color }} />
        <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>{color.name}</Text>
      </View>
      <View style={{ marginBottom: 24 }}>
        <HabitColorGrid selected={color.color} onSelect={props.onColor} />
      </View>

      {/* Optional personal motivation. */}
      <View style={{ marginBottom: 24 }}>
        <GoalField goal={props.goal} onGoal={props.onGoal} />
      </View>

      <GradientButton
        text={trimmed ? `Create "${trimmed}"` : 'Enter a habit name'}
        onPress={props.onCreate}
        colors={[color.color, `${color.color}BF`]}
        contentColor={color.light ? '#1A1A1A' : '#FFFFFF'}
        enabled={canCreateHabit(name)}
      />
    </>
  );
}

/** Orange streak pill (HabitsScreen.kt `StreakBadge`), used in the create preview. */
export function StreakBadge({ streak }: { streak: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, backgroundColor: '#FF8C001F', borderWidth: 1, borderColor: '#FF8C004D', paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontSize: 12 }}>🔥</Text>
      <Text style={{ color: Brand.Orange, fontSize: 12, fontWeight: '800' }}>{streak}</Text>
      <Text style={{ color: `${Brand.Orange}B3`, fontSize: 10, fontWeight: '500' }}>{streak === 1 ? 'day' : 'days'}</Text>
    </View>
  );
}
