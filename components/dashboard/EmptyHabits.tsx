import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/hooks/useTheme';
import { Coral, type HomePalette } from '@/theme';

type Props = { p: HomePalette; onCreate: () => void };

/**
 * Home when there are no habits at all (a new guest or account, or after the last habit is deleted). It replaces the whole dashboard body
 * (week selector, day grid, list and Today's Progress); the top bar stays. Centred in the content column, compact on a phone.
 */
export function EmptyHabits({ p, onCreate }: Props) {
  const { t } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingBottom: 72 }}>
      <View style={{ width: '100%', maxWidth: 440, alignItems: 'center' }}>
        <View
          style={{
            width: 104,
            height: 104,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: p.card,
            borderWidth: 1,
            borderColor: p.cardBorder,
            marginBottom: 22,
          }}
        >
          <Icon name="eco" size={34} color={Coral} />
        </View>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' }}>
          Create your first habit
        </Text>
        <Text style={{ marginTop: 10, color: t.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>
          Small steps lead to big changes. Start building a better routine, one habit at a time.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create your first habit"
          onPress={onCreate}
          style={({ pressed }) => ({
            marginTop: 26,
            minHeight: 52,
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingHorizontal: 22,
            borderRadius: 16,
            backgroundColor: Coral,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Icon name="add" size={22} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Create Your First Habit</Text>
        </Pressable>
        <Text style={{ marginTop: 16, color: t.muted, fontSize: 12, textAlign: 'center' }}>You can start small and build consistency at your own pace.</Text>
      </View>
    </View>
  );
}
