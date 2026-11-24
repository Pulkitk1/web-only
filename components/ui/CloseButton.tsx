import { useTheme } from '@/hooks/useTheme';
import { Icon } from './Icon';
import { SquareIconButton } from './SquareIconButton';

export function CloseButton({ onPress, size = 32 }: { onPress: () => void; size?: number }) {
  const { t } = useTheme();
  return (
    <SquareIconButton onPress={onPress} size={size} background={t.closeBg} label="Close">
      <Icon name="close" size={15} color={t.muted} />
    </SquareIconButton>
  );
}
