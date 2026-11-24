/**
 * The message that outlives a failed account deletion, shown on whichever screen the user is on (after a failure the app comes back on
 * Home, not Settings, so a message tied to Settings would never be seen). It sits IN the page layout above the screen, pushing it down, so
 * it never covers a button. Dismissible; it is cleared when a new deletion starts.
 * Successful deletions are shown on the login screen instead (see `AuthScreens`).
 */
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/store/SessionStore';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';

export function AccountNotice() {
  const { t, isDark } = useTheme();
  const { notice, controller } = useSession();
  if (!notice || notice.kind !== 'error') return null;
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 }}>
      <View
        accessibilityRole="alert"
        style={{
          width: '100%',
          maxWidth: 560,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: withAlpha(Brand.Red, 0.45),
          backgroundColor: isDark ? '#2A1A1A' : '#FFECEC',
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <View style={{ paddingTop: 1 }}>
          <Icon name="error-outline" size={16} color={Brand.Red} />
        </View>
        <Text style={{ flex: 1, color: t.text, fontSize: 12, lineHeight: 17 }}>{notice.message}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => controller.dismissNotice()}>
          <Icon name="close" size={16} color={t.muted} />
        </Pressable>
      </View>
    </View>
  );
}
