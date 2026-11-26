import { router } from 'expo-router';
import { View } from 'react-native';
import { useT } from '@/i18n';
import { useColors } from '@/theme/theme';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { EmptyState } from '@/ui/States';
import { Question } from '@/ui/icons';

/** A link to something that no longer exists, or never did. */
export default function NotFound() {
  const t = useT();
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader />
      <EmptyState icon={Question} message={t('post.unavailable')} actionLabel={t('tab.home')} onAction={() => router.replace('/')} />
    </View>
  );
}
