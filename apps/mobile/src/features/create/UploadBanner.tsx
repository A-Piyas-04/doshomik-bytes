import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/i18n';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { CheckCircle, X } from '@/ui/icons';
import { useUploads } from './uploads';

/** The upload in progress, above the tab bar on every tab: progress, processing, live or failed. */
export function UploadBanner() {
  const t = useT();
  const colors = useColors();
  const job = useUploads((s) => s.job);
  const retry = useUploads((s) => s.retry);
  const dismiss = useUploads((s) => s.dismiss);
  if (!job) return null;

  const label =
    job.status === 'uploading'
      ? t('create.uploading', { p: Math.round(job.progress * 100) })
      : job.status === 'processing'
        ? t('create.processing')
        : job.status === 'live'
          ? t('create.live')
          : t('create.failed');

  return (
    <View style={[styles.banner, { backgroundColor: colors.surface, borderTopColor: colors.border }]} accessibilityLiveRegion="polite">
      <Image source={{ uri: job.preview }} style={[styles.thumb, { backgroundColor: colors.elevated }]} contentFit="cover" />
      <View style={styles.flex}>
        <AppText variant="label" weight="semibold" tone={job.status === 'failed' ? 'danger' : 'text'} numberOfLines={1}>
          {label}
        </AppText>
        {job.status === 'failed' && job.error ? (
          <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
            {job.error}
          </AppText>
        ) : null}
        {job.status === 'uploading' || job.status === 'processing' ? (
          <View style={[styles.track, { backgroundColor: colors.elevated }]}>
            <View style={[styles.fill, { backgroundColor: colors.accent, width: `${Math.round((job.status === 'processing' ? 1 : job.progress) * 100)}%`, opacity: job.status === 'processing' ? 0.5 : 1 }]} />
          </View>
        ) : null}
      </View>
      {job.status === 'live' ? <CheckCircle size={22} weight="fill" color={colors.accent} /> : null}
      {job.status === 'failed' ? <Button label={t('common.retry')} size="sm" kind="secondary" onPress={retry} /> : null}
      {job.status !== 'uploading' ? <IconButton icon={X} size={18} label={t('common.close')} onPress={dismiss} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: layout.screenPadding, paddingRight: space.xs, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  thumb: { width: 36, height: 36, borderRadius: radius.xs },
  flex: { flex: 1, gap: space.xs },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3 },
});
