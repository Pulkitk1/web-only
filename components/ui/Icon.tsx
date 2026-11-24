import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type Props = { name: ComponentProps<typeof MaterialIcons>['name']; size: number; color: string };

/**
 * Material icon. Android uses Material Icons "Rounded"/"Outlined" variants; the web build ships the filled
 * Material set, so a few glyphs differ slightly in shape (see the Phase 2 report).
 */
export function Icon({ name, size, color }: Props) {
  return <MaterialIcons name={name} size={size} color={color} />;
}
