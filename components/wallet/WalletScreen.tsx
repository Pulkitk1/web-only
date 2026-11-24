/**
 * Wallet (android WalletScreen.kt): COINS and STREAK FREEZES balances (with the pending-adjustment ⓘ), "How to earn",
 * "How to use", the freeze status card with its Buy button, the "Buy Streak Freeze" sheet and the "How it works" dialog.
 * Kotlin has no transaction-history list on this screen, so none is shown. All numbers come from the shared AppStore.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet, CenterModal, Toast, useToast } from '@/components/ui/overlays';
import { SquareIconButton } from '@/components/ui/SquareIconButton';
import { FREEZE_PRICE_COINS, MAX_FREEZE_APPLICATIONS_PER_MONTH } from '@/domain/freeze';
import { MILESTONE_BONUSES } from '@/domain/rewards';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore } from '@/store/AppStore';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';

const MAX = MAX_FREEZE_APPLICATIONS_PER_MONTH;
const COST = FREEZE_PRICE_COINS;
const BONUSES = Object.entries(MILESTONE_BONUSES).map(([day, bonus]) => [Number(day), bonus] as const);

function Divider() {
  const { t } = useTheme();
  return <View style={{ height: 1, backgroundColor: t.border }} />;
}

function WalletCard({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  return <View style={{ borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, paddingHorizontal: 16, paddingVertical: 18 }}>{children}</View>;
}

function CardTitle({ title, subtitle }: { title: string; subtitle: string }) {
  const { t } = useTheme();
  return (
    <>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>{title}</Text>
      <Text style={{ color: t.muted, fontSize: 11, marginBottom: 12 }}>{subtitle}</Text>
    </>
  );
}

function EarnRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text style={{ flex: 1, color: t.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: Brand.Gold, fontSize: 13, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

function BalanceCard({ label, value, accent, icon, trailing, style }: { label: string; value: string; accent: string; icon: ReactNode; trailing?: ReactNode; style?: object }) {
  const { t } = useTheme();
  return (
    <View
      style={[
        { borderRadius: 24, borderWidth: 1.5, borderColor: withAlpha(accent, 0.3), padding: 16, gap: 8, backgroundImage: `linear-gradient(135deg, ${withAlpha(accent, 0.18)}, ${withAlpha(accent, 0.06)})` } as object,
        style,
      ]}
    >
      {icon}
      <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.8 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text accessibilityLabel={`${label}: ${value}`} numberOfLines={1} style={{ color: accent, fontSize: 36, fontWeight: '800', letterSpacing: -1.5, lineHeight: 38 }}>
          {value}
        </Text>
        {trailing}
      </View>
    </View>
  );
}

function BeforeAfter({ before, after, color }: { before: string; after: string; color: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{before}</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>→</Text>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{after}</Text>
    </View>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: t.muted, fontSize: 14 }}>{label}</Text>
      {children}
    </View>
  );
}

function BuyFreezeSheet({ visible, coins, freezesLeft, busy, onClose, onConfirm }: { visible: boolean; coins: number; freezesLeft: number; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useTheme();
  const after = coins - COST;
  // While a purchase is running the button is off (Kotlin `canBuyFreeze` includes `!walletBusy`), so a second tap can't start another one.
  const canBuy = coins >= COST && freezesLeft > 0 && !busy;
  return (
    <BottomSheet visible={visible} onDismiss={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 20 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>Buy Streak Freeze</Text>
        <CloseButton onPress={onClose} />
      </View>
      <View style={{ marginBottom: 20, borderRadius: 16, backgroundColor: t.option, borderWidth: 1, borderColor: t.border, padding: 16 }}>
        <DetailRow label="Cost">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CoinIcon size={16} />
            <Text style={{ color: Brand.Gold, fontSize: 14, fontWeight: '700' }}>{`${COST} coins`}</Text>
          </View>
        </DetailRow>
        <View style={{ height: 1, backgroundColor: t.border, marginVertical: 12 }} />
        <DetailRow label="Your coins">
          <BeforeAfter before={`${coins}`} after={`${Math.max(0, after)}`} color={after >= 0 ? Brand.Green : Brand.Error} />
        </DetailRow>
        <View style={{ height: 8 }} />
        <DetailRow label="Freezes left">
          <BeforeAfter before={`${freezesLeft}/${MAX}`} after={`${Math.max(0, freezesLeft - 1)}/${MAX}`} color={Brand.Blue} />
        </DetailRow>
      </View>
      {!canBuy && !busy && (
        <Text style={{ color: Brand.Error, fontSize: 13, marginBottom: 16, borderRadius: 12, backgroundColor: withAlpha(Brand.Error, 0.1), borderWidth: 1, borderColor: withAlpha(Brand.Error, 0.25), paddingHorizontal: 16, paddingVertical: 12, overflow: 'hidden' }}>
          {coins < COST ? `You need ${COST - coins} more coins to buy a Freeze.` : `You've reached the monthly freeze limit (${MAX}/month).`}
        </Text>
      )}
      <GradientButton text={busy ? 'Purchasing…' : canBuy ? '❄️  Confirm Purchase' : coins < COST ? 'Need More Coins' : 'Limit Reached'} onPress={onConfirm} colors={[Brand.Blue, Brand.BlueAlt]} contentColor="#FFFFFF" enabled={canBuy} />
      <Text style={{ color: t.muted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>{`Max ${MAX} streak freezes per month`}</Text>
    </BottomSheet>
  );
}

export function WalletScreen() {
  const { t, isDark, toggle } = useTheme();
  const store = useAppStore();
  const router = useRouter();
  const toast = useToast();
  const [showBuy, setShowBuy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [width, setWidth] = useState(0);
  const { walletNotice, consumeWalletNotice } = store;
  useEffect(() => {
    if (!walletNotice) return;
    toast.show(walletNotice, 3000);
    consumeWalletNotice();
  }, [walletNotice, consumeWalletNotice, toast.show]);

  const { coins, freezesOwned, freezesLeft, canBuyFreeze, pendingAdjustment } = store;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/habits'));
  const n = pendingAdjustment;
  const coinsWord = n === 1 ? 'coin' : 'coins';

  const coinCard = (
    <BalanceCard
      label="COINS"
      value={`${coins}`}
      accent={Brand.Gold}
      icon={<CoinIcon size={34} />}
      style={{ flex: width < 300 ? undefined : 1 }}
      trailing={
        n > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Pending coin adjustment" onPress={() => setShowPending(true)} style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="info-outline" size={18} color={t.muted} />
          </Pressable>
        ) : null
      }
    />
  );
  const freezeCard = (
    <BalanceCard
      label="STREAK FREEZES"
      value={`${freezesOwned}`}
      accent={Brand.Blue}
      icon={
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: withAlpha(Brand.Blue, 0.16), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="ac-unit" size={20} color={Brand.Blue} />
        </View>
      }
      style={{ flex: width < 300 ? undefined : 1 }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 }}>
          <SquareIconButton onPress={back} size={36} label="Back">
            <Icon name="arrow-back" size={18} color={t.text} />
          </SquareIconButton>
          <Text accessibilityRole="header" style={{ flex: 1, color: t.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 }}>
            Wallet
          </Text>
          <SquareIconButton onPress={toggle} label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {isDark ? <Icon name="dark-mode" size={16} color={Brand.Purple} /> : <Icon name="light-mode" size={16} color={Brand.Amber} />}
          </SquareIconButton>
          <SquareIconButton onPress={() => setShowInfo(true)} label="How it works">
            <Icon name="info-outline" size={16} color={t.muted} />
          </SquareIconButton>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
          {/* Balances side by side (stacked on very narrow screens). */}
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: width < 300 ? 'column' : 'row', gap: 12, alignItems: 'stretch' }}>
            {coinCard}
            {freezeCard}
          </View>

          <WalletCard>
            <CardTitle title="How to earn 🪙" subtitle="Complete habits daily to stack coins" />
            <EarnRow icon="✅" label="Complete all habits" value="+1 coin/day" />
            <Divider />
            {BONUSES.map(([day, bonus]) => (
              <View key={day}>
                <Divider />
                <EarnRow icon={day >= 100 ? '🏆' : '🎯'} label={`Day ${day} milestone`} value={`+${bonus} bonus`} />
              </View>
            ))}
          </WalletCard>

          <WalletCard>
            <CardTitle title="How to use ❄️" subtitle="Spend coins to protect your streak" />
            <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12 }}>
              <Text style={{ fontSize: 20 }}>❄️</Text>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row' }}>
                  <Text style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: '600' }}>Streak Freeze</Text>
                  <Text style={{ color: Brand.Gold, fontSize: 14, fontWeight: '700' }}>{`${COST} coins`}</Text>
                </View>
                <Text style={{ color: t.muted, fontSize: 12, marginTop: 3 }}>Protects your streak on a missed active day</Text>
              </View>
            </View>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 12 }}>
              <Text style={{ flex: 1, color: t.muted, fontSize: 13 }}>Freezes available to purchase</Text>
              <Text style={{ color: freezesLeft > 0 ? Brand.Blue : Brand.Error, fontSize: 14, fontWeight: '700' }}>{`❄️ ${freezesLeft}/${MAX}`}</Text>
            </View>
          </WalletCard>

          {/* Freeze status */}
          <View
            style={
              {
                borderRadius: 16,
                paddingHorizontal: 16,
                paddingVertical: 18,
                borderWidth: canBuyFreeze ? 1.5 : 1,
                borderColor: canBuyFreeze ? withAlpha(Brand.Blue, 0.35) : t.border,
                backgroundColor: canBuyFreeze ? undefined : t.card,
                backgroundImage: canBuyFreeze ? `linear-gradient(135deg, ${withAlpha(Brand.Blue, 0.12)}, ${withAlpha(Brand.Blue, 0.04)})` : undefined,
              } as object
            }
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>Streak Freeze ❄️</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>{`Max ${MAX} per month`}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: withAlpha(Brand.Gold, 0.12), borderWidth: 1, borderColor: withAlpha(Brand.Gold, 0.25), paddingHorizontal: 12, paddingVertical: 6 }}>
                <CoinIcon size={16} />
                <Text style={{ color: Brand.Gold, fontSize: 14, fontWeight: '700' }}>{`${COST}`}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {Array.from({ length: MAX }, (_, i) => (
                <View
                  key={i}
                  testID="freeze-slot"
                  style={{ flex: 1, height: 6, borderRadius: 3, ...(i < freezesLeft ? ({ backgroundImage: `linear-gradient(90deg, ${Brand.Blue}, ${Brand.BlueAlt})` } as object) : { backgroundColor: t.disabled }) }}
                />
              ))}
            </View>
            <GradientButton
              text={canBuyFreeze ? `❄️  Buy Streak Freeze — ${COST} Coins` : coins < COST ? `Need ${COST - coins} more coins` : 'Monthly limit reached'}
              onPress={() => setShowBuy(true)}
              colors={[Brand.Blue, Brand.BlueAlt]}
              contentColor="#FFFFFF"
              enabled={canBuyFreeze}
              radius={16}
              verticalPadding={14}
              fontSize={15}
            />
          </View>
        </ScrollView>
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <BuyFreezeSheet
          visible={showBuy}
          coins={coins}
          freezesLeft={freezesLeft}
          busy={store.walletBusy}
          onClose={() => setShowBuy(false)}
          onConfirm={async () => {
            const r = await store.buyFreeze();
            if (!r.message) return; // a second tap while a purchase was already running: nothing to say
            if (r.ok) setShowBuy(false);
            // The new inventory count is appended to a success message (`You own N.`); for an account it is the confirmed count.
            toast.show(r.ok ? `${r.message} You own ${r.owned ?? freezesOwned + 1}.` : r.message, 2500);
          }}
        />
        <CenterModal visible={showInfo} onDismiss={() => setShowInfo(false)} scrimAlpha={0.6} contentPadding={20}>
          <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ flex: 1, color: t.text, fontSize: 17, fontWeight: '700' }}>How it works</Text>
            <CloseButton onPress={() => setShowInfo(false)} size={30} />
          </View>
          {[
            ['🪙', 'Earn 1 coin when you complete ALL habits in a day'],
            ['🎯', `Earn a bonus for each habit's streak: ${BONUSES.map(([d, b]) => `Day ${d} +${b}`).join(', ')}`],
            ['❄️', `Spend ${COST} coins to buy a Streak Freeze`],
            ['📅', `Max ${MAX} Streak Freezes per month`],
            ['🛡️', 'Freeze protects your streak on a missed active day'],
          ].map(([icon, label]) => (
            <View key={label} style={{ alignSelf: 'stretch', flexDirection: 'row', gap: 12, marginBottom: 12 }}>
              <Text style={{ fontSize: 16 }}>{icon}</Text>
              <Text style={{ flex: 1, color: t.muted, fontSize: 13 }}>{label}</Text>
            </View>
          ))}
        </CenterModal>
        <CenterModal visible={showPending && n > 0} onDismiss={() => setShowPending(false)} scrimAlpha={0.6} contentPadding={20}>
          <Text style={{ alignSelf: 'flex-start', color: t.text, fontSize: 17, fontWeight: '700', marginBottom: 12 }}>{`Pending coin adjustment: ${n} ${coinsWord}`}</Text>
          <Text style={{ alignSelf: 'flex-start', color: t.muted, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>{`You've already used these ${n} ${coinsWord}. Your next earned coins will be used to balance your rewards.`}</Text>
          <View style={{ alignSelf: 'stretch' }}>
            <GhostButton text="Got it" onPress={() => setShowPending(false)} />
          </View>
        </CenterModal>
        <Toast message={toast.message} borderColor={withAlpha(Brand.Blue, 0.2)} />
      </View>
    </View>
  );
}
