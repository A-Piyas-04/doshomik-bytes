import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnreadCount } from '@/api/social';
import { useT } from '@/i18n';
import { usePrefs } from '@/lib/prefs';
import { go } from '@/shell/nav';
import { useTheme } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { IconButton } from '@/ui/IconButton';
import { Bell, Plus } from '@/ui/icons';
import { Tap } from '@/ui/Tap';

const LOCKUPS = {
  dark: { en: require('../../../assets/brand/lockup-en-light.png'), bn: require('../../../assets/brand/lockup-bn-light.png') },
  light: { en: require('../../../assets/brand/lockup-en.png'), bn: require('../../../assets/brand/lockup-bn.png') },
};
/** The EN lockup is wide and short, the BN one taller; size both to the same visual weight. */
const SIZE = { en: { width: 104, height: 28 }, bn: { width: 71, height: 33 } };

/**
 * Home's header: Create on the left, the wordmark in the middle (in the app's language), the
 * language switch and Notifications on the right.
 */
export function HomeHeader({ onCreate }: { onCreate: () => void }) {
  const { scheme, colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const lang = usePrefs((s) => s.lang);
  const setPrefs = usePrefs((s) => s.set);
  const unread = useUnreadCount();
  const count = unread.data ?? 0;

  return (
    <View style={[styles.bar, { paddingTop: insets.top, backgroundColor: colors.bg }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          <IconButton icon={Plus} weight="bold" label={t('header.create')} onPress={onCreate} />
        </View>
        <Image source={LOCKUPS[scheme][lang]} style={SIZE[lang]} contentFit="contain" accessibilityLabel="Doshomik Bytes" accessibilityRole="header" />
        <View style={[styles.side, styles.right]}>
          <Tap
            onPress={() => setPrefs({ lang: lang === 'en' ? 'bn' : 'en' })}
            accessibilityLabel={t('header.langToggleLabel')}
            accessibilityRole="switch"
            accessibilityState={{ checked: lang === 'bn' }}
            style={styles.langHit}
            hitSlop={4}
          >
            <View style={[styles.lang, { backgroundColor: colors.elevated }]}>
              {(['bn', 'en'] as const).map((option) => (
                <View key={option} style={[styles.langOption, option === lang ? { backgroundColor: colors.surface, borderColor: colors.border } : null]}>
                  <AppText variant="micro" weight="semibold" tone={option === lang ? 'text' : 'textTertiary'}>
                    {option === 'bn' ? 'বাং' : 'EN'}
                  </AppText>
                </View>
              ))}
            </View>
          </Tap>
          <IconButton
            icon={Bell}
            label={count > 0 ? t('header.notificationsUnread', { n: count }) : t('header.notifications')}
            dot={count > 0}
            onPress={go.notifications}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {},
  row: { height: layout.headerHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs },
  side: { width: 112, flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end' },
  langHit: { height: 44, justifyContent: 'center', paddingHorizontal: space.xs },
  lang: { flexDirection: 'row', borderRadius: radius.sm, padding: 2, height: 30 },
  langOption: { paddingHorizontal: space.sm, borderRadius: 6, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
});
