import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { StyleSheet, View } from 'react-native';
import { useMe } from '@/api/social';
import { UploadBanner } from '@/features/create/UploadBanner';
import { useT, type MessageKey } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { BookOpen, FilmSlate, House, MagnifyingGlass, type IconComponent } from '@/ui/icons';
import { Tap } from '@/ui/Tap';

const TABS: Record<string, { label: MessageKey; icon?: IconComponent }> = {
  '(home)': { label: 'tab.home', icon: House },
  '(learn)': { label: 'tab.learn', icon: BookOpen },
  '(explore)': { label: 'tab.explore', icon: MagnifyingGlass },
  '(reels)': { label: 'tab.reels', icon: FilmSlate },
  '(profile)': { label: 'tab.profile' },
};

/**
 * The bottom bar: five tabs with labels (icons alone make people guess). The active tab gets the
 * filled icon, full-strength label and a small amber dot under it. It stays on Reels too, as in
 * other short-video apps, so there is always a way out; the single-reel viewer covers it.
 */
export function BrandTabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const colors = useColors();
  const t = useT();
  const me = useMe();

  return (
    <View>
    <UploadBanner />
    <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        const onPress = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        const tint = focused ? colors.text : colors.textTertiary;
        const Icon = tab.icon;
        return (
          <Tap
            key={route.key}
            onPress={onPress}
            onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(tab.label)}
            feedback="none"
            style={styles.tab}
          >
            {Icon ? (
              <Icon size={25} color={tint} weight={focused ? 'fill' : 'regular'} />
            ) : (
              <View style={[styles.avatarRing, { borderColor: focused ? colors.text : 'transparent' }]}>
                <Avatar url={me.data?.avatar_url} name={me.data?.display_name ?? me.data?.username ?? '?'} size={24} />
              </View>
            )}
            <AppText variant="micro" weight={focused ? 'semibold' : 'medium'} style={{ color: tint }} numberOfLines={1}>
              {t(tab.label)}
            </AppText>
            <View style={[styles.dot, { backgroundColor: focused ? colors.highlight : 'transparent' }]} />
          </Tap>
        );
      })}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, height: layout.tabBarHeight, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: space.xs },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
  avatarRing: { borderWidth: 1.5, borderRadius: 14, padding: 1 },
});
