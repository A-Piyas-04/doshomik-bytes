import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keys, queryClient } from '@/api/query';
import { useMe, useUpdateMe } from '@/api/social';
import type { Account } from '@/api/types';
import { useT } from '@/i18n';
import { uploadMedia } from '@/lib/upload';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Camera } from '@/ui/icons';
import { KeyboardView } from '@/ui/Keyboard';
import { Tap } from '@/ui/Tap';
import { TextField } from '@/ui/TextField';
import { toast } from '@/ui/Toast';

/** Edit profile: name, bio and photo. The username and email change in the account phase (later). */
export function EditProfileScreen() {
  const me = useMe();
  const colors = useColors();
  if (!me.data) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <EditProfileForm account={me.data} />;
}

function EditProfileForm({ account }: { account: Account }) {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const update = useUpdateMe();
  const [name, setName] = useState(account.display_name ?? '');
  const [bio, setBio] = useState(account.bio ?? '');
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const changePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return toast(t('create.permission'), { tone: 'error' });
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setPhoto(asset.uri);
    setUploading(true);
    try {
      const size = asset.fileSize ?? asset.file?.size ?? (await (await fetch(asset.uri)).blob()).size;
      await uploadMedia({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', size, file: asset.file }, { kind: 'image', purpose: 'avatar' }, () => undefined);
      toast(t('ep.photoProcessing'));
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: keys.me }), 6000);
    } catch {
      toast(t('common.actionFailed'), { tone: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const save = () =>
    update.mutate(
      { display_name: name.trim() || null, bio: bio.trim() || null },
      {
        onSuccess: () => {
          toast(t('ep.saved'));
          router.back();
        },
      },
    );

  return (
    <View style={[styles.root, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Button label={t('common.cancel')} kind="ghost" size="sm" onPress={() => router.back()} />
        <AppText variant="bodyStrong" style={styles.title}>
          {t('ep.title')}
        </AppText>
        <Button label={t('common.save')} size="sm" loading={update.isPending} onPress={save} />
      </View>
      <KeyboardView>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Tap onPress={() => void changePhoto()} style={styles.photo} disabled={uploading}>
            {photo ? <Avatar url={photo} name={name} size={88} /> : <Avatar url={account.avatar_url} name={name || account.username} size={88} />}
            <View style={styles.photoLabel}>
              <Camera size={16} color={colors.accent} />
              <AppText variant="label" tone="accent">
                {t('ep.photo')}
              </AppText>
            </View>
          </Tap>
          <TextField label={t('ep.name')} value={name} onChangeText={setName} placeholder={t('ep.namePlaceholder')} maxLength={50} />
          <TextField label={t('ep.bio')} value={bio} onChangeText={setBio} placeholder={t('ep.bioPlaceholder')} maxLength={300} counter multiline />
          <AppText variant="caption" tone="textTertiary">
            {`@${account.username}`}
          </AppText>
        </ScrollView>
      </KeyboardView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, textAlign: 'center' },
  scroll: { padding: layout.screenPadding, gap: space.lg },
  photo: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  photoLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
