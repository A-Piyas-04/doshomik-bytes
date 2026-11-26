import { noOutline } from '@/ui/noOutline';
import { REEL_MAX_SECONDS } from '@doshomik/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, usePreventRemove } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { useTopics } from '@/api/learn';
import { keys } from '@/api/query';
import { useT, translate } from '@/i18n';
import { hasBengali } from '@/lib/script';
import type { PickedFile } from '@/lib/upload';
import { fontFamily } from '@/theme/fonts';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { confirm } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { SectionLabel } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { ChipRow } from '@/ui/Chips';
import { FilmSlate, ImageGlyph } from '@/ui/icons';
import { KeyboardView } from '@/ui/Keyboard';
import { Tap } from '@/ui/Tap';
import { toast } from '@/ui/Toast';
import { ALL, FieldChips } from '../fields';
import { useUploads } from './uploads';

type Kind = 'text' | 'image' | 'reel';

const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 150 * 1024 * 1024;
const NONE = 'none';

async function sizeOf(uri: string, known?: number | null): Promise<number> {
  if (known) return known;
  const blob = await (await fetch(uri)).blob();
  return blob.size;
}

/**
 * Create a post: text, one image, or one reel (up to 90 seconds, checked when it is picked and
 * again by the server). Optional caption and topic tag. Cancel asks before throwing work away;
 * Post closes the screen at once and the upload carries on in the banner.
 */
export function CreatePostScreen({ kind }: { kind: Kind }) {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const startUpload = useUploads((s) => s.start);
  const busyUpload = useUploads((s) => s.job && (s.job.status === 'uploading' || s.job.status === 'processing'));
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<(PickedFile & { preview: string; seconds?: number }) | null>(null);
  const [area, setArea] = useState(ALL);
  const [topic, setTopic] = useState(NONE);
  const [posting, setPosting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const topics = useTopics(area === ALL ? undefined : area);

  const dirty = !leaving && (caption.trim().length > 0 || !!file);
  usePreventRemove(dirty, ({ repeat }) => {
    void confirm({ title: t('create.discardTitle'), message: t('create.discardBody'), confirmLabel: t('common.discard'), destructive: true }).then((ok) => {
      if (!ok) return;
      setLeaving(true);
      repeat();
    });
  });

  const pick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return toast(t('create.permission'), { tone: 'error' });
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'reel' ? ['videos'] : ['images'],
      quality: 0.9,
      videoMaxDuration: REEL_MAX_SECONDS,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    if (kind === 'reel') {
      const seconds = asset.duration ? Math.round(asset.duration / 1000) : 0;
      if (seconds > REEL_MAX_SECONDS) return toast(t('create.reelTooLong', { n: seconds }), { tone: 'error' });
      const size = await sizeOf(asset.uri, asset.fileSize);
      if (size > VIDEO_MAX) return toast(t('create.tooLarge'), { tone: 'error' });
      setFile({ uri: asset.uri, mimeType: asset.mimeType ?? 'video/mp4', size, file: asset.file, preview: asset.uri, seconds });
      return;
    }

    // Images: send at most 2048 px wide as JPEG; the server makes the feed sizes.
    let uri = asset.uri;
    let mimeType = asset.mimeType ?? 'image/jpeg';
    let blob: Blob | undefined = asset.file;
    if (asset.width > 2048 || !/jpe?g|png|webp/.test(mimeType)) {
      const rendered = await ImageManipulator.manipulate(asset.uri).resize({ width: Math.min(asset.width, 2048) }).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      uri = saved.uri;
      mimeType = 'image/jpeg';
      blob = undefined;
    }
    const size = blob?.size ?? (await sizeOf(uri, uri === asset.uri ? asset.fileSize : undefined));
    if (size > IMAGE_MAX) return toast(t('create.tooLarge'), { tone: 'error' });
    if (Platform.OS === 'web' && !blob) blob = await (await fetch(uri)).blob();
    setFile({ uri, mimeType, size, file: blob, preview: uri });
  };

  const canPost = kind === 'text' ? caption.trim().length > 0 : !!file && !busyUpload;
  const post = async () => {
    if (!canPost) return;
    const chosenTopic = topic === NONE ? null : topic;
    if (kind === 'text') {
      setPosting(true);
      try {
        await api.post('/posts', { type: 'text', caption: caption.trim(), topic: chosenTopic ?? undefined });
        void queryClient.invalidateQueries({ queryKey: keys.feed });
        void queryClient.invalidateQueries({ queryKey: ['user'] });
        toast(translate('create.live'));
        setLeaving(true);
        setTimeout(() => router.back(), 0);
      } catch {
        toast(translate('common.actionFailed'), { tone: 'error' });
      } finally {
        setPosting(false);
      }
      return;
    }
    startUpload({ kind, file: file!, caption: caption.trim() || null, topic: chosenTopic, preview: file!.preview });
    setLeaving(true);
    setTimeout(() => router.back(), 0);
  };

  const title = kind === 'text' ? t('create.newText') : kind === 'image' ? t('create.newImage') : t('create.newReel');
  const topicOptions = [{ value: NONE, label: t('te.fieldNone') }, ...(topics.data ?? []).map((tp) => ({ value: tp.slug, label: tp.name }))];

  return (
    <View style={[styles.root, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Button label={t('common.cancel')} kind="ghost" size="sm" onPress={() => router.back()} />
        <AppText variant="bodyStrong" style={styles.title} numberOfLines={1}>
          {title}
        </AppText>
        <Button label={t('create.post')} size="sm" disabled={!canPost} loading={posting} onPress={() => void post()} />
      </View>
      <KeyboardView>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {kind !== 'text' ? (
            file ? (
              <View style={styles.preview}>
                {kind === 'image' ? (
                  <Image source={{ uri: file.preview }} style={[styles.image, { backgroundColor: colors.bg }]} contentFit="contain" />
                ) : (
                  <View style={[styles.video, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                    <FilmSlate size={32} color={colors.accent} />
                    <AppText variant="bodyStrong">{t('common.seconds', { n: file.seconds ?? 0 })}</AppText>
                  </View>
                )}
                <Button label={t('create.change')} kind="secondary" size="sm" onPress={() => void pick()} />
              </View>
            ) : (
              <Tap onPress={() => void pick()} style={[styles.picker, { borderColor: colors.border, backgroundColor: colors.bg }]}>
                {kind === 'image' ? <ImageGlyph size={32} color={colors.accent} /> : <FilmSlate size={32} color={colors.accent} />}
                <AppText variant="bodyStrong" tone="accent">
                  {kind === 'image' ? t('create.pickImage') : t('create.pickVideo')}
                </AppText>
                <AppText variant="caption" tone="textTertiary">
                  {kind === 'image' ? t('create.imageHint') : t('create.reelHint')}
                </AppText>
              </Tap>
            )
          ) : null}

          <TextInput
            value={caption}
            onChangeText={setCaption}
            autoFocus={kind === 'text'}
            multiline
            maxLength={2200}
            placeholder={kind === 'text' ? t('create.textPlaceholder') : t('create.captionPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            accessibilityLabel={kind === 'text' ? t('create.textPlaceholder') : t('create.captionPlaceholder')}
            style={[noOutline, 
              styles.caption,
              kind === 'text' ? styles.captionLarge : null,
              { color: colors.text, fontFamily: fontFamily('sans', 'regular', hasBengali(caption) ? 'bengali' : 'latin') },
            ]}
          />
          <AppText variant="caption" tone="textTertiary" style={styles.counter}>
            {t('create.chars', { n: caption.length, max: 2200 })}
          </AppText>

          <SectionLabel label={t('create.topic')} />
          <AppText variant="caption" tone="textSecondary" style={styles.pad}>
            {t('create.topicHint')}
          </AppText>
          <FieldChips value={area} onChange={(value) => { setArea(value); setTopic(NONE); }} style={styles.chips} />
          <ChipRow options={topicOptions} value={topic} onChange={setTopic} style={styles.chips} />
        </ScrollView>
      </KeyboardView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, gap: space.sm },
  title: { flex: 1, textAlign: 'center' },
  scroll: { paddingBottom: space.x5 },
  picker: { margin: layout.screenPadding, height: 200, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  preview: { padding: layout.screenPadding, gap: space.md, alignItems: 'flex-start' },
  image: { width: '100%', aspectRatio: 1, borderRadius: radius.sm },
  video: { width: '100%', height: 160, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  caption: { paddingHorizontal: layout.screenPadding, paddingTop: space.md, fontSize: 16, minHeight: 80, textAlignVertical: 'top' },
  captionLarge: { fontSize: 19, minHeight: 180 },
  counter: { paddingHorizontal: layout.screenPadding, textAlign: 'right' },
  pad: { paddingHorizontal: layout.screenPadding, paddingBottom: space.sm },
  chips: { flexGrow: 0, paddingBottom: space.sm },
});
