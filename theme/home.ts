/**
 * Home-only surfaces from HabitsScreen.kt `homePalette()`: a navy-tinted charcoal in dark mode; the light theme keeps
 * the shared tokens.
 */
import type { Tokens } from './colors';

export type HomePalette = {
  bg: string;
  card: string;
  cardBorder: string;
  control: string;
  controlBorder: string;
  missed: string;
  missedMark: string;
  track: string;
};

export function homePalette(t: Tokens): HomePalette {
  return t.isDark
    ? {
        bg: '#0D1117',
        card: '#161B23',
        cardBorder: 'rgba(255,255,255,0.05)',
        control: '#1B212B',
        controlBorder: 'rgba(255,255,255,0.09)',
        missed: '#242B36',
        missedMark: '#9AA3B2',
        track: '#262D38',
      }
    : {
        bg: t.bg,
        card: t.card,
        cardBorder: t.border,
        control: t.chip,
        controlBorder: t.border,
        missed: '#E9EBEF',
        missedMark: '#8A8F98',
        track: t.track,
      };
}

/** Habit colour palette from CreateHabitSheet.kt `HABIT_PALETTE`. `light` = use a dark mark/text on top. */
export type PaletteColor = { name: string; color: string; light?: boolean };

export const HABIT_PALETTE: PaletteColor[] = [
  { name: 'Green', color: '#4ADE80' },
  { name: 'Emerald', color: '#34D399', light: true },
  { name: 'Teal', color: '#2DD4BF' },
  { name: 'Cyan', color: '#22D3EE', light: true },
  { name: 'Sky', color: '#38BDF8' },
  { name: 'Blue', color: '#60A5FA' },
  { name: 'Indigo', color: '#818CF8' },
  { name: 'Violet', color: '#A78BFA' },
  { name: 'Purple', color: '#C084FC' },
  { name: 'Pink', color: '#F472B6' },
  { name: 'Rose', color: '#FB7185' },
  { name: 'Red', color: '#F87171' },
  { name: 'Orange', color: '#FB923C' },
  { name: 'Amber', color: '#FBBF24', light: true },
  { name: 'Yellow', color: '#FDE68A', light: true },
  { name: 'Lime', color: '#A3E635', light: true },
  { name: 'Slate', color: '#94A3B8' },
  { name: 'Pearl', color: '#F1F5F9', light: true },
];
