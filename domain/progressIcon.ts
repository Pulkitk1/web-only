/** Geometry of the "dots ahead" logo in its 120x120 viewBox (android ProgressIcon.kt `ProgressIconGeometry`). */
export function progressIconGeometry(progress: number) {
  const p = Number.isNaN(progress) ? 0 : Math.min(1, Math.max(0, progress));
  const TRACK_X = 18;
  const TRACK_WIDTH = 84;
  const tip = Math.min(94, Math.max(24, TRACK_X + TRACK_WIDTH * p));
  const complete = p >= 1;
  const d1 = tip + 14;
  const d2 = tip + 23;
  return {
    fillWidth: TRACK_WIDTH * p,
    tipX: tip,
    dot1X: !complete && d1 <= 100 ? d1 : null,
    dot2X: !complete && d2 <= 98 ? d2 : null,
    complete,
  };
}

/** `done` of `total` as 0-1; 0 when nothing is due. */
export const progressOf = (done: number, total: number) => (total <= 0 ? 0 : Math.min(1, Math.max(0, done / total)));
