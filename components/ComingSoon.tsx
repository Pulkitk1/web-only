import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/hooks/useTheme';
import { Brand, homePalette } from '@/theme';

/** Stand-in for screens that belong to later migration phases. Only keeps dashboard navigation from dead-ending. */
export function ComingSoon({ title, note }: { title: string; note?: string }) {
  const { t } = useTheme();
  const p = homePalette(t);
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 }}>{title}</Text>
      <Text style={{ color: t.muted, fontSize: 14, marginTop: 8, textAlign: 'center' }}>{note ?? 'This screen is migrated in a later phase.'}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/habits'))}
        style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: p.control, borderWidth: 1, borderColor: p.controlBorder }}
      >
        <Icon name="chevron-left" size={20} color={Brand.Green} />
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>Back to Habits</Text>
      </Pressable>
    </View>
  );
}
