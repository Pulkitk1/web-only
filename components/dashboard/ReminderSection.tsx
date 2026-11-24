/**
 * The "Reminder" block of a habit (android ReminderSection.kt): an on/off switch and, while on, the time.
 * Web differences: the time is picked with the browser's time input, and the web app cannot deliver reminders (a browser cannot run a
 * scheduled notification while the site is closed without a server to push it), so the block says so plainly and never asks for
 * notification permission. The choice is still saved with the habit: a signed-in account's Android app reads it and schedules the reminder.
 */
import { createElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { formatTime12h, DEFAULT_REMINDER_TIME } from '@/domain/reminder';
import { WEB_REMINDERS_NOTE } from '@/domain/settingsContent';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/store/SessionStore';
import { Brand } from '@/theme';

type Props = {
  enabled: boolean;
  /** "HH:mm" */
  time: string;
  onEnabled: (on: boolean) => void;
  onTime: (hhmm: string) => void;
  accent?: string;
};

export function ReminderSection({ enabled, time, onEnabled, onTime, accent = Brand.Green }: Props) {
  const { t, isDark } = useTheme();
  const { kind } = useSession();
  const card = isDark ? '#1E1E1E' : '#FFFFFF';
  const where = kind === 'firebase' ? 'saved with this habit for the Android app' : 'saved with this habit on this device';
  return (
    <View style={{ width: '100%', borderRadius: 16, backgroundColor: card, borderWidth: 1, borderColor: t.border }}>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Reminder"
        accessibilityState={{ checked: enabled }}
        onPress={() => onEnabled(!enabled)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>Reminder</Text>
          <Text testID="reminder-web-note" style={{ color: t.muted, fontSize: 12, lineHeight: 17 }}>{`${WEB_REMINDERS_NOTE} Your choice is ${where}.`}</Text>
        </View>
        <ToggleSwitch value={enabled} />
      </Pressable>
      {enabled && (
        <>
          <View style={{ height: 1, backgroundColor: t.border }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
            <Text style={{ flex: 1, color: t.muted, fontSize: 13 }}>Reminder time</Text>
            <Text style={{ color: accent, fontSize: 15, fontWeight: '700' }}>{formatTime12h(time)}</Text>
            {/* A transparent native time input covers the row, so a click opens the browser's picker. */}
            {createElement('input', {
              type: 'time',
              value: time,
              'aria-label': 'Reminder time',
              onChange: (e: { target: { value: string } }) => e.target.value && onTime(e.target.value),
              style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0 },
            })}
          </View>
        </>
      )}
    </View>
  );
}

export { DEFAULT_REMINDER_TIME };
