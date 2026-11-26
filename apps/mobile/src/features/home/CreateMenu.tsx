import { StyleSheet, View } from 'react-native';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { BottomSheet } from '@/ui/BottomSheet';
import { FilmSlate, ImageGlyph, TextT, type IconComponent } from '@/ui/icons';
import { Tap } from '@/ui/Tap';

const OPTIONS: { kind: 'text' | 'image' | 'reel'; icon: IconComponent; title: 'create.text' | 'create.image' | 'create.reel'; hint: 'create.textHint' | 'create.imageHint' | 'create.reelHint' }[] = [
  { kind: 'text', icon: TextT, title: 'create.text', hint: 'create.textHint' },
  { kind: 'image', icon: ImageGlyph, title: 'create.image', hint: 'create.imageHint' },
  { kind: 'reel', icon: FilmSlate, title: 'create.reel', hint: 'create.reelHint' },
];

/** Create: three rows (Text, Image, Reel), each opening its own full-screen flow. */
export function CreateMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const colors = useColors();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('create.title')}>
      {OPTIONS.map(({ kind, icon: Icon, title, hint }) => (
        <Tap
          key={kind}
          feedback="fill"
          onPress={() => {
            onClose();
            go.create(kind);
          }}
          style={styles.row}
        >
          <View style={[styles.icon, { borderColor: colors.border }]}>
            <Icon size={22} color={colors.text} />
          </View>
          <View style={styles.text}>
            <AppText variant="bodyStrong">{t(title)}</AppText>
            <AppText variant="caption" tone="textSecondary">
              {t(hint)}
            </AppText>
          </View>
        </Tap>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  icon: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
