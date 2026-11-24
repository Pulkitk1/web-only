/** Apply an alpha (0-1) to a #RRGGBB colour, like Compose's `Color.copy(alpha = ...)`. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Relative luminance (0-1) of a #RRGGBB colour, as Compose's `Color.luminance()`. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const lin = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}

/** Linear blend of two #RRGGBB colours (Compose `lerp`), returned as #RRGGBB. */
export function lerpColor(a: string, b: string, t: number): string {
  const pa = a.replace('#', '');
  const pb = b.replace('#', '');
  const ch = (i: number) => {
    const x = parseInt(pa.slice(i, i + 2), 16);
    const y = parseInt(pb.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

/** Android `readableOn`: in the light theme, pale habit colours are darkened so text on a light card stays readable. */
export const readableOn = (color: string, isDark: boolean): string =>
  isDark || luminance(color) < 0.5 ? color : lerpColor(color, '#000000', 0.45);
