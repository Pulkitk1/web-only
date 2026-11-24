import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

/** Close an overlay on Escape (the web equivalent of Android's BackHandler). */
function useEscape(enabled: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    // Capture phase: React Native Web's TextInput stops keydown from bubbling, so a focused field would swallow Escape.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [enabled, onDismiss]);
}

/** Fades 0 -> 1 on mount (the scrim: `Scrim` in Components.kt). */
function Scrim({ alpha, onDismiss }: { alpha: number; onDismiss: () => void }) {
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(o, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  }, [o]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${alpha})`, opacity: o }]}>
      <Pressable accessibilityLabel="Dismiss" style={StyleSheet.absoluteFill} onPress={onDismiss} />
    </Animated.View>
  );
}

type CenterModalProps = {
  visible: boolean;
  onDismiss: () => void;
  scrimAlpha?: number;
  contentPadding?: number;
  children: ReactNode;
};

/** Centered modal card with a dimmed backdrop (Components.kt `CenterModal`): fade + scale 0.92 -> 1 over 250 ms. */
export function CenterModal({ visible, onDismiss, scrimAlpha = 0.65, contentPadding = 24, children }: CenterModalProps) {
  const { t } = useTheme();
  const k = useRef(new Animated.Value(0)).current;
  useEscape(visible, onDismiss);
  useEffect(() => {
    if (!visible) return;
    k.setValue(0);
    Animated.timing(k, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [visible, k]);
  if (!visible) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50, alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
      <Scrim alpha={scrimAlpha} onDismiss={onDismiss} />
      <Animated.View
        accessibilityViewIsModal
        style={{
          width: '100%',
          maxWidth: 440,
          maxHeight: '100%',
          opacity: k,
          transform: [{ scale: k.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          backgroundColor: t.sheet,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: t.border,
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        }}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: contentPadding, paddingVertical: 28, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

type SheetProps = {
  visible: boolean;
  onDismiss: () => void;
  maxHeightFraction?: number;
  scrimAlpha?: number;
  children: ReactNode;
};

/** Bottom sheet drawn inside the screen (Components.kt `BottomSheet`): slides up over 320 ms, handle on top. */
export function BottomSheet({ visible, onDismiss, maxHeightFraction = 0.9, scrimAlpha = 0.65, children }: SheetProps) {
  const { t } = useTheme();
  const { height } = useWindowDimensions();
  const k = useRef(new Animated.Value(0)).current;
  useEscape(visible, onDismiss);
  useEffect(() => {
    if (!visible) return;
    k.setValue(0);
    Animated.timing(k, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [visible, k]);
  if (!visible) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50, justifyContent: 'flex-end', alignItems: 'center' }]}>
      <Scrim alpha={scrimAlpha} onDismiss={onDismiss} />
      <Animated.View
        accessibilityViewIsModal
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: height * maxHeightFraction,
          backgroundColor: t.sheet,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          transform: [{ translateY: k.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }],
        }}
      >
        <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 12 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/** Toast state (Components.kt `ToastState`): `show(text, ms)` replaces any current toast. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, durationMs = 2200) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(null), durationMs);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return { message, show };
}

/** Pill-shaped toast pinned to the bottom of the parent (Components.kt `Toast`). */
export function Toast({ message, bottomOffset = 32, borderColor }: { message: string | null; bottomOffset?: number; borderColor?: string }) {
  const { t } = useTheme();
  const k = useRef(new Animated.Value(0)).current;
  const last = useRef('');
  if (message) last.current = message;
  useEffect(() => {
    Animated.timing(k, { toValue: message ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [message, k]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        zIndex: 60,
        bottom: bottomOffset,
        left: 16,
        right: 16,
        alignItems: 'center',
        opacity: k,
        transform: [{ translateY: k.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      <View
        style={{
          backgroundColor: t.isDark ? 'rgba(30,30,40,0.96)' : 'rgba(255,255,255,0.96)',
          borderRadius: 20,
          borderWidth: 1,
          borderColor: borderColor ?? t.border,
          paddingHorizontal: 20,
          paddingVertical: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          maxWidth: 520,
        }}
      >
        <Text style={{ color: t.text, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{last.current}</Text>
      </View>
    </Animated.View>
  );
}

type MenuProps = { open: boolean; onClose: () => void; align?: 'left' | 'right'; minWidth?: number; children: ReactNode };

/** Dropdown menu anchored under its trigger (Material `DropdownMenu`): 16 radius, `menu` surface. */
export function DropdownMenu({ open, onClose, align = 'left', minWidth = 150, children }: MenuProps) {
  const { t } = useTheme();
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <>
      <Pressable
        accessibilityLabel="Close menu"
        onPress={onClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 } as object}
      />
      <View
        accessibilityRole="menu"
        style={{
          position: 'absolute',
          top: '100%',
          [align]: 0,
          minWidth,
          zIndex: 45,
          backgroundColor: t.menu,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.border,
          paddingVertical: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
        }}
      >
        {children}
      </View>
    </>
  );
}

export function MenuItem({ label, color, icon, bold, onPress }: { label: string; color: string; icon?: ReactNode; bold?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}
    >
      {icon}
      <Text style={{ color, fontSize: 13, fontWeight: bold ? '700' : '600' }}>{label}</Text>
    </Pressable>
  );
}
