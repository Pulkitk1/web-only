/**
 * Dashboard popups ported from android/.../ui/components/Popups.kt: CoinEarnPopup, GuestBonusPopup, MissedDayFreezeModal.
 * Values (20 coins, 3 per month, +1 daily, welcome freeze) come from the shared domain constants, which mirror Kotlin.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';

import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { Icon } from '@/components/ui/Icon';
import { CenterModal } from '@/components/ui/overlays';
import { FREEZE_PRICE_COINS, MAX_FREEZE_APPLICATIONS_PER_MONTH } from '@/domain/freeze';
import { MILESTONE_BONUSES } from '@/domain/rewards';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';

export const GUEST_BONUS = 20; // AppViewModel.kt GUEST_BONUS

const GOLD_GRADIENT: [string, string] = [Brand.Gold, `${Brand.Gold}BF`];
const BLUE_GRADIENT: [string, string] = [Brand.Blue, Brand.BlueAlt];

function Title({ children, color, size = 21 }: { children: string; color?: string; size?: number }) {
  const { t } = useTheme();
  return (
    <Text style={{ color: color ?? t.text, fontSize: size, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', marginBottom: 6 }}>{children}</Text>
  );
}

function Body({ children, bottom = 20 }: { children: string; bottom?: number }) {
  const { t } = useTheme();
  return <Text style={{ color: t.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: bottom }}>{children}</Text>;
}

function Pill({ text, color, background, borderColor }: { text: string; color: string; background: string; borderColor: string }) {
  return (
    <View style={{ marginBottom: 12, borderRadius: 50, backgroundColor: background, borderWidth: 1, borderColor, paddingHorizontal: 12, paddingVertical: 4 }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

/** Rounded content box with a border (the option-coloured info boxes). */
function InfoBox({ children, background, borderColor, row }: { children: ReactNode; background: string; borderColor: string; row?: boolean }) {
  return (
    <View
      style={{
        width: '100%',
        marginBottom: 20,
        borderRadius: 16,
        backgroundColor: background,
        borderWidth: 1,
        borderColor,
        paddingHorizontal: 16,
        paddingVertical: 14,
        ...(row ? { flexDirection: 'row', alignItems: 'center', gap: 12 } : {}),
      }}
    >
      {children}
    </View>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ flex: 1, color: t.muted, fontSize: 13 }}>{label}</Text>
      {children}
    </View>
  );
}

// ─── Coin earned ─────────────────────────────────────────────────────────────

/** Shown when every habit is done for a day. `milestone` is e.g. 15 or 30 for bonus days. */
export function CoinEarnPopup({
  visible,
  coinsEarned,
  milestone,
  onClose,
  onGoToWallet,
}: {
  visible: boolean;
  coinsEarned: number;
  milestone?: number | null;
  onClose: () => void;
  onGoToWallet: () => void;
}) {
  const { t } = useTheme();
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    const id = setTimeout(
      () => Animated.timing(pop, { toValue: 1, duration: 350, easing: Easing.bezier(0.34, 1.56, 0.64, 1), useNativeDriver: false }).start(),
      80,
    );
    return () => clearTimeout(id);
  }, [visible, pop]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });

  return (
    <CenterModal visible={visible} onDismiss={onClose}>
      {milestone != null && <Pill text={`🏅 Day ${milestone} Milestone`} color={Brand.Gold} background="rgba(242,211,107,0.15)" borderColor="rgba(242,211,107,0.35)" />}

      <View style={{ marginBottom: 12, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ opacity: pop, position: 'absolute', width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(242,211,107,0.18)' }} />
        <Animated.View style={{ transform: [{ scale }] }}>
          <CoinIcon size={64} />
        </Animated.View>
      </View>

      <Animated.View
        style={{
          transform: [{ scale }],
          marginBottom: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderRadius: 50,
          backgroundColor: 'rgba(242,211,107,0.12)',
          borderWidth: 1.5,
          borderColor: 'rgba(242,211,107,0.35)',
          paddingHorizontal: 16,
          paddingVertical: 6,
        }}
      >
        <Text style={{ fontSize: 20 }}>🪙</Text>
        <Text style={{ color: Brand.Gold, fontSize: 22, fontWeight: '800' }}>{`+${coinsEarned}`}</Text>
      </Animated.View>

      <Title>Nice work! 🎉</Title>
      <Body>
        {milestone != null
          ? `Milestone! You earned +${coinsEarned} coins\n(includes the +${MILESTONE_BONUSES[milestone] ?? 0} Day ${milestone} bonus)`
          : `You earned +${coinsEarned} coin`}
      </Body>

      <View
        style={{
          width: '100%',
          marginBottom: 20,
          borderRadius: 12,
          backgroundColor: t.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
          borderWidth: 1,
          borderColor: t.border,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: t.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' }}>
          {`💡 Coins help you buy a Streak Freeze (${FREEZE_PRICE_COINS} coins). Limit: ${MAX_FREEZE_APPLICATIONS_PER_MONTH}/month.`}
        </Text>
      </View>

      <GradientButton text="Continue" onPress={onClose} colors={GOLD_GRADIENT} contentColor={Brand.GoldInk} radius={16} verticalPadding={14} fontSize={15} />
      <View style={{ height: 10 }} />
      <GhostButton
        text="Go to Wallet →"
        onPress={() => {
          onClose();
          onGoToWallet();
        }}
        bordered={false}
        fontSize={13}
        verticalPadding={10}
      />
    </CenterModal>
  );
}

// ─── Guest bonus ─────────────────────────────────────────────────────────────

type GuestPhase = 'guest' | 'claim' | 'claimed' | 'alreadyClaimed';

export function GuestBonusPopup({
  visible,
  alreadyClaimed,
  onClaim,
  onClose,
}: {
  visible: boolean;
  alreadyClaimed: boolean;
  onClaim: () => void;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const [phase, setPhase] = useState<GuestPhase>('guest');
  useEffect(() => {
    if (visible) setPhase(alreadyClaimed ? 'alreadyClaimed' : 'guest');
  }, [visible, alreadyClaimed]);
  useEffect(() => {
    if (phase !== 'claimed') return;
    const id = setTimeout(onClose, 2000);
    return () => clearTimeout(id);
  }, [phase, onClose]);

  const InfoRow = ({ icon, text }: { icon: string; text: string }) => (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={{ flex: 1, color: t.muted, fontSize: 13 }}>{text}</Text>
    </View>
  );

  return (
    <CenterModal visible={visible} onDismiss={onClose}>
      {phase === 'guest' && (
        <>
          <View style={{ width: 76, height: 60, marginBottom: 16 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ position: 'absolute', left: i * 16, top: i === 1 ? 0 : 8 }}>
                <CoinIcon size={44} rings={false} />
              </View>
            ))}
          </View>
          <Title size={22}>{`${GUEST_BONUS} coins unlocked 🎁`}</Title>
          <Body>Create habits and earn more coins daily.</Body>
          <InfoBox background={t.option} borderColor={t.border}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>Learn how it works</Text>
              <InfoRow icon="🪙" text="Earn: +1 coin/day when all habits are completed" />
              <InfoRow icon="❄️" text={`Use: Streak Freeze (${FREEZE_PRICE_COINS} coins each), max ${MAX_FREEZE_APPLICATIONS_PER_MONTH}/month`} />
            </View>
          </InfoBox>
          <GradientButton text="Login to sync →" onPress={() => setPhase('claim')} colors={GOLD_GRADIENT} contentColor={Brand.GoldInk} radius={16} verticalPadding={14} fontSize={15} />
          <View style={{ height: 10 }} />
          <GhostButton text="Skip for now" onPress={onClose} bordered={false} fontSize={13} verticalPadding={10} />
          <Text style={{ color: t.muted, fontSize: 11, textAlign: 'center' }}>Coins are stored on this device until you log in.</Text>
        </>
      )}

      {phase === 'claim' && (
        <>
          <View style={{ marginBottom: 16 }}>
            <CoinIcon size={64} rings={false} />
          </View>
          <Title>Claim &amp; sync your coins</Title>
          <Body>{`Your ${GUEST_BONUS} bonus coins will be linked to your account.`}</Body>
          <InfoBox row background="rgba(242,211,107,0.1)" borderColor="rgba(242,211,107,0.3)">
            <Text style={{ fontSize: 24 }}>🎁</Text>
            <View>
              <Text style={{ color: Brand.Gold, fontSize: 15, fontWeight: '700' }}>{`+${GUEST_BONUS} Bonus Coins`}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>Added to your wallet on claim</Text>
            </View>
          </InfoBox>
          <GradientButton
            text="🪙 Claim now"
            onPress={() => {
              onClaim();
              setPhase('claimed');
            }}
            colors={GOLD_GRADIENT}
            contentColor={Brand.GoldInk}
            radius={16}
            verticalPadding={14}
            fontSize={15}
          />
        </>
      )}

      {(phase === 'claimed' || phase === 'alreadyClaimed') && (
        <>
          <Text style={{ fontSize: 48, marginTop: 8, marginBottom: 12 }}>🎉</Text>
          <Title color={Brand.Green}>{phase === 'claimed' ? `+${GUEST_BONUS} coins added!` : 'Bonus already claimed'}</Title>
          <Body bottom={phase === 'claimed' ? 8 : 20}>
            {phase === 'claimed' ? 'Coins synced to your Wallet.' : 'Your bonus coins are already in your Wallet.'}
          </Body>
          {phase === 'alreadyClaimed' && <GhostButton text="Close" onPress={onClose} />}
        </>
      )}
    </CenterModal>
  );
}

// ─── Missed day / freeze ─────────────────────────────────────────────────────

export function MissedDayFreezeModal({
  visible,
  habitName,
  dateLabel,
  freezesLeft,
  ownedFreezes,
  onUseFreeze,
  onBreakStreak,
  onClose,
  onGoToWallet,
}: {
  visible: boolean;
  habitName: string;
  dateLabel: string;
  freezesLeft: number;
  /** Purchased/welcome freezes; applying one of these costs no coins. */
  ownedFreezes: number;
  onUseFreeze: () => void;
  onBreakStreak: () => void;
  onClose: () => void;
  onGoToWallet: () => void;
}) {
  const { t } = useTheme();
  // Applying always uses an owned freeze; coins are only spent when buying one in the Wallet.
  const canAfford = ownedFreezes > 0;
  const withinLimit = freezesLeft > 0;
  const canUse = canAfford && withinLimit;

  return (
    <CenterModal visible={visible} onDismiss={onClose} scrimAlpha={0.7} contentPadding={22}>
      <View style={{ width: '100%', alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{
            position: 'absolute',
            top: -12,
            right: 0,
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: t.faint,
            borderWidth: 1,
            borderColor: t.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="close" size={16} color={t.muted} />
        </Pressable>
        <View
          style={{
            marginBottom: 16,
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: 'rgba(77,163,255,0.12)',
            borderWidth: 2,
            borderColor: 'rgba(77,163,255,0.4)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 30 }}>❄️</Text>
        </View>
      </View>

      <Title size={20}>You missed an active day</Title>
      <Text style={{ color: t.muted, fontSize: 13, textAlign: 'center', marginBottom: 4 }}>{`${habitName} — ${dateLabel}`}</Text>
      <Body>Use a Streak Freeze to protect your streak?</Body>

      <InfoBox background={t.option} borderColor={t.border}>
        <DetailRow label="Cost">
          <Text style={{ color: Brand.Blue, fontSize: 14, fontWeight: '700' }}>❄️ 1 Streak Freeze</Text>
        </DetailRow>
        <View style={{ height: 1, backgroundColor: t.border, marginVertical: 12 }} />
        <DetailRow label="Your freezes">
          <Text style={{ color: canAfford ? t.text : Brand.Error, fontSize: 14, fontWeight: '600' }}>{`❄️ ${ownedFreezes}`}</Text>
        </DetailRow>
        <View style={{ height: 8 }} />
        <DetailRow label="Freezes left">
          <Text style={{ color: withinLimit ? Brand.Blue : Brand.Error, fontSize: 14, fontWeight: '700' }}>{`❄️ ${freezesLeft}/${MAX_FREEZE_APPLICATIONS_PER_MONTH}`}</Text>
        </DetailRow>
      </InfoBox>

      {!canUse && (
        <View
          style={{
            width: '100%',
            marginBottom: 16,
            borderRadius: 12,
            backgroundColor: 'rgba(248,113,113,0.08)',
            borderWidth: 1,
            borderColor: 'rgba(248,113,113,0.25)',
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: Brand.Error, fontSize: 13, textAlign: 'center' }}>
            {!canAfford
              ? 'No Streak Freezes Available. Buy one in your Wallet first.'
              : `You've used ${MAX_FREEZE_APPLICATIONS_PER_MONTH}/${MAX_FREEZE_APPLICATIONS_PER_MONTH} freezes this month.`}
          </Text>
        </View>
      )}

      {canUse ? (
        <>
          <GradientButton text="❄️  Use Freeze" onPress={onUseFreeze} colors={BLUE_GRADIENT} contentColor="#FFFFFF" radius={16} verticalPadding={14} fontSize={15} />
          <View style={{ height: 10 }} />
          <GhostButton text="No, break streak" onPress={onBreakStreak} />
        </>
      ) : !canAfford ? (
        <>
          <GradientButton
            text="🪙 Go to Wallet"
            onPress={() => {
              onClose();
              onGoToWallet();
            }}
            colors={GOLD_GRADIENT}
            contentColor={Brand.GoldInk}
            radius={16}
            verticalPadding={14}
            fontSize={15}
          />
          <View style={{ height: 10 }} />
          <GhostButton text="Close" onPress={onClose} />
        </>
      ) : (
        <GhostButton text="OK" onPress={onClose} fontSize={15} verticalPadding={14} />
      )}
    </CenterModal>
  );
}
