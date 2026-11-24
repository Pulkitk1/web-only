import { Pressable, Text, View } from 'react-native';

import { CoinIcon } from '@/components/ui/CoinIcon';
import { Icon } from '@/components/ui/Icon';
import { SquareIconButton } from '@/components/ui/SquareIconButton';
import { useTheme } from '@/hooks/useTheme';
import { Brand, type HomePalette } from '@/theme';

type Props = {
  title: string;
  coins: number;
  p: HomePalette;
  onWallet: () => void;
  onSettings: () => void;
  onAdd: () => void;
};

/** Home top bar (HabitsScreen.kt `TopBar`): chart icon, title, coin pill, theme toggle, settings, add. */
export function TopBar({ title, coins, p, onWallet, onSettings, onAdd }: Props) {
  const { t, isDark, toggle } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 16, paddingTop: 12, paddingBottom: 6 }}>
      <Icon name="bar-chart" size={26} color={Brand.Purple} />
      <Text numberOfLines={1} style={{ flex: 1, marginLeft: 6, color: t.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Wallet, ${coins} coins`}
          onPress={onWallet}
          style={({ pressed }) => ({
            height: 36,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            borderRadius: 12,
            backgroundColor: `rgba(242,211,107,${isDark ? 0.14 : 0.2})`,
            borderWidth: 1,
            borderColor: 'rgba(242,211,107,0.6)',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <CoinIcon size={16} rings={false} />
          <Text style={{ color: isDark ? Brand.Gold : Brand.GoldInk, fontSize: 14, fontWeight: '700' }}>{coins}</Text>
        </Pressable>
        <SquareIconButton
          onPress={toggle}
          size={36}
          background={p.control}
          borderColor={p.controlBorder}
          label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Icon name="dark-mode" size={17} color="#CBD2DC" /> : <Icon name="light-mode" size={17} color={Brand.Amber} />}
        </SquareIconButton>
        <SquareIconButton onPress={onSettings} size={36} background={p.control} borderColor={p.controlBorder} label="Settings">
          <Icon name="settings" size={17} color={t.text} />
        </SquareIconButton>
        <SquareIconButton
          onPress={onAdd}
          size={36}
          background="rgba(74,222,128,0.14)"
          borderColor="rgba(74,222,128,0.7)"
          label="New habit"
        >
          <Icon name="add" size={20} color={isDark ? Brand.GreenAlt : '#16A34A'} />
        </SquareIconButton>
      </View>
    </View>
  );
}
