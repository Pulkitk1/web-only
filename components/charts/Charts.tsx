/**
 * Line and bar charts of Habit Details (android Charts.kt): dashed horizontal grid with y labels, rounded bar tops or a
 * smooth line with dots, x labels, and tap a point or bar to see its value in a small tooltip.
 * Geometry and hit-testing come from `domain/habitDetail.ts` (unit-tested); this file only draws it with SVG.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import {
  barAlpha,
  barIndexAt,
  barLayout,
  lineIndexAt,
  linePoints,
  plotRect,
  smoothPath,
  tooltipBox,
  yAt,
  type ChartPoint,
} from '@/domain/habitDetail';

export type ChartColors = { grid: string; /** The selection cursor line (grid colour at 50%). */ cursor: string; label: string; tooltipBg: string; tooltipBorder: string; tooltipText: string };

type Common = {
  data: ChartPoint[];
  colors: ChartColors;
  yMax: number;
  yTicks: number[];
  tooltip: (p: ChartPoint) => string;
  height?: number;
};

/** Shared frame: dashed grid lines and the y-axis labels. */
function Frame({ width, height, yMax, yTicks, yFormat, colors }: { width: number; height: number; yMax: number; yTicks: number[]; yFormat: (n: number) => string; colors: ChartColors }) {
  const p = plotRect(width, height);
  return (
    <>
      {[0, ...yTicks].map((tick) => {
        const y = yAt(p, tick, yMax);
        return (
          <G key={tick}>
            <Line x1={p.left} y1={y} x2={p.right} y2={y} stroke={colors.grid} strokeWidth={1} strokeDasharray="4 4" />
            {tick !== 0 && (
              <SvgText x={p.left - 6} y={y + 3} fontSize={9} fill={colors.label} textAnchor="end">
                {yFormat(tick)}
              </SvgText>
            )}
          </G>
        );
      })}
    </>
  );
}

/** Tooltip box (title + body), placed like Kotlin `drawTooltip`. */
function Tooltip({ title, body, anchor, width, height, colors }: { title: string; body: string; anchor: { x: number; y: number }; width: number; height: number; colors: ChartColors }) {
  const pad = 8;
  const w = Math.max(title.length, body.length) * 6.1 + pad * 2;
  const h = 2 * 14 + pad * 2;
  const { x, y } = tooltipBox(anchor, w, h, width, height);
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: x, top: y, paddingHorizontal: pad, paddingVertical: pad, borderRadius: 10, backgroundColor: colors.tooltipBg, borderWidth: 1, borderColor: colors.tooltipBorder }}
    >
      <Text style={{ color: colors.tooltipText, fontSize: 11, fontWeight: '600' }}>{title}</Text>
      <Text style={{ color: colors.tooltipText, fontSize: 11 }}>{body}</Text>
    </View>
  );
}

/** Click handler that maps a click to the x position inside the chart box. */
function useChart(initialHeight: number) {
  const [width, setWidth] = useState(300);
  const [selected, setSelected] = useState<number | null>(null);
  return { width, setWidth, selected, setSelected, height: initialHeight };
}

/** Smooth line chart (0..yMax); tap a point to see its value. */
export function LineChart({ data, color, colors, yMax, yTicks, yFormat, tooltip, height = 160, labelEvery = 2 }: Common & { color: string; yFormat: (n: number) => string; labelEvery?: number }) {
  const { width, setWidth, selected, setSelected } = useChart(height);
  const p = plotRect(width, height);
  const pts = linePoints(data, p, yMax);
  return (
    <View
      style={{ width: '100%', height }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      // Plain DOM click (React Native Web): the x position is measured inside the chart box.
      {...({
        onClick: (e: { clientX: number; currentTarget: HTMLElement }) => {
          const idx = lineIndexAt(e.clientX - e.currentTarget.getBoundingClientRect().left, p, data.length);
          if (idx !== null) setSelected(selected === idx ? null : idx);
        },
      } as object)}
    >
      <Svg width={width} height={height}>
        <Frame width={width} height={height} yMax={yMax} yTicks={yTicks} yFormat={yFormat} colors={colors} />
        {data.length > 0 && (
          <>
            <Path d={smoothPath(pts)} stroke={color} strokeWidth={2.5} fill="none" />
            {pts.map((pt, i) => (
              <Circle key={i} cx={pt.x} cy={pt.y} r={i === selected ? 5 : 3.5} fill={color} />
            ))}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <SvgText key={`l${i}`} x={pts[i].x} y={p.bottom + 5 + 8} fontSize={8} fill={colors.label} textAnchor="middle">
                  {d.label}
                </SvgText>
              ) : null,
            )}
            {selected !== null && <Line x1={pts[selected].x} y1={p.top} x2={pts[selected].x} y2={p.bottom} stroke={colors.cursor} strokeWidth={1} />}
          </>
        )}
      </Svg>
      {selected !== null && <Tooltip title={data[selected].label} body={tooltip(data[selected])} anchor={pts[selected]} width={width} height={height} colors={colors} />}
    </View>
  );
}

/** Bar chart with rounded tops; `color` is tinted by value (>=15 full, >=8 at 67%, else 33%). Tap a bar to see its value. */
export function BarChart({ data, color, colors, yMax, yTicks, tooltip, height = 150, barWidth = 14 }: Common & { color: string; barWidth?: number }) {
  const { width, setWidth, selected, setSelected } = useChart(height);
  const p = plotRect(width, height);
  const bars = barLayout(data, p, yMax);
  return (
    <View
      style={{ width: '100%', height }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...({
        onClick: (e: { clientX: number; currentTarget: HTMLElement }) => {
          const idx = barIndexAt(e.clientX - e.currentTarget.getBoundingClientRect().left, p, data.length);
          if (idx !== null) setSelected(selected === idx ? null : idx);
        },
      } as object)}
    >
      <Svg width={width} height={height}>
        <Frame width={width} height={height} yMax={yMax} yTicks={yTicks} yFormat={(n) => `${n}`} colors={colors} />
        {data.map((d, i) => {
          const b = bars[i];
          const h = p.bottom - b.top;
          const r = Math.min(6, Math.max(0, h), barWidth / 2);
          const x = b.cx - barWidth / 2;
          return (
            <G key={i}>
              {i === selected && <Rect x={b.bandLeft} y={p.top} width={b.band} height={p.bottom - p.top} fill={colors.grid} />}
              {Math.abs(h) > 0.5 && (
                <Path
                  d={`M ${x} ${p.bottom} L ${x} ${b.top + r} Q ${x} ${b.top} ${x + r} ${b.top} L ${x + barWidth - r} ${b.top} Q ${x + barWidth} ${b.top} ${x + barWidth} ${b.top + r} L ${x + barWidth} ${p.bottom} Z`}
                  fill={color}
                  fillOpacity={barAlpha(d.value)}
                />
              )}
              <SvgText x={b.cx} y={p.bottom + 5 + 9} fontSize={9} fill={colors.label} textAnchor="middle">
                {d.label}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      {selected !== null && <Tooltip title={data[selected].label} body={tooltip(data[selected])} anchor={{ x: bars[selected].cx, y: (p.top + p.bottom) / 2 }} width={width} height={height} colors={colors} />}
    </View>
  );
}
