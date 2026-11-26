import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useBlock, useBlocks, useMe, useSavedPosts, useUpdateMe } from '@/api/social';
import type { Post } from '@/api/types';
import { useT } from '@/i18n';
import { usePrefs, type DevUser, type Lang, type ThemePreference } from '@/lib/prefs';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Divider, ListFooter, NavRow, SectionLabel } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { ChipRow } from '@/ui/Chips';
import { BookmarkSimple, Lock, MapTrifold, Prohibit } from '@/ui/icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState } from '@/ui/States';
import { go } from '@/shell/nav';
import { PostTile } from '../explore/PostTile';
import { InterestsSheet } from '../fields';

/** Settings: language and theme, your fields, saved posts, privacy and blocked accounts. */
export function SettingsScreen() {
  const t = useT();
  const colors = useColors();
  const queryClient = useQueryClient();
  const lang = usePrefs((s) => s.lang);
  const theme = usePrefs((s) => s.theme);
  const devUser = usePrefs((s) => s.devUser);
  const setPrefs = usePrefs((s) => s.set);
  const me = useMe();
  const update = useUpdateMe();
  const [interests, setInterests] = useState(false);
  const surface = [styles.surface, { backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('set.title')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <SectionLabel label={t('set.app')} />
        <View style={surface}>
          <View style={styles.choice}>
            <AppText variant="bodyStrong">{t('set.language')}</AppText>
            <ChipRow<Lang>
              wrap
              options={[
                { value: 'en', label: 'English' },
                { value: 'bn', label: 'বাংলা' },
              ]}
              value={lang}
              onChange={(value) => setPrefs({ lang: value })}
            />
          </View>
          <Divider />
          <View style={styles.choice}>
            <AppText variant="bodyStrong">{t('set.theme')}</AppText>
            <ChipRow<ThemePreference>
              wrap
              options={[
                { value: 'light', label: t('set.themeLight') },
                { value: 'dark', label: t('set.themeDark') },
                { value: 'system', label: t('set.themeSystem') },
              ]}
              value={theme}
              onChange={(value) => setPrefs({ theme: value })}
            />
          </View>
        </View>

        <SectionLabel label={t('set.account')} />
        <View style={surface}>
          <NavRow icon={MapTrifold} title={t('set.interests')} subtitle={t('int.hint')} onPress={() => setInterests(true)} />
          <Divider inset={layout.screenPadding + 52} />
          <NavRow icon={BookmarkSimple} title={t('set.savedPosts')} onPress={go.savedPosts} />
          <Divider inset={layout.screenPadding + 52} />
          <View style={styles.toggleRow}>
            <View style={[styles.icon, { borderColor: colors.border }]}>
              <Lock size={20} color={colors.text} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">{t('set.private')}</AppText>
              <AppText variant="caption" tone="textSecondary">
                {t('set.privateHint')}
              </AppText>
            </View>
            <Switch
              value={me.data?.is_private ?? false}
              onValueChange={(value) => update.mutate({ is_private: value })}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.surface}
              accessibilityLabel={t('set.private')}
            />
          </View>
          <Divider inset={layout.screenPadding + 52} />
          <NavRow icon={Prohibit} title={t('set.blocked')} onPress={go.blocked} />
        </View>

        {__DEV__ ? (
          <>
            <SectionLabel label={t('set.devUser')} />
            <View style={[surface, styles.choice]}>
              <ChipRow<DevUser>
                wrap
                options={(['admin', 'learner1', 'learner2'] as const).map((value) => ({ value, label: value }))}
                value={devUser ?? 'admin'}
                onChange={(value) => {
                  setPrefs({ devUser: value });
                  // Everything cached belongs to the previous account.
                  queryClient.clear();
                }}
              />
            </View>
          </>
        ) : null}

        <SectionLabel label={t('set.about')} />
        <AppText variant="caption" tone="textTertiary" style={styles.pad}>
          {`Doshomik Bytes · ${t('set.version', { v: Constants.expoConfig?.version ?? '0' })}`}
        </AppText>
      </ScrollView>
      <InterestsSheet visible={interests} onClose={() => setInterests(false)} />
    </View>
  );
}

export function SavedPostsScreen() {
  const t = useT();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const saved = useSavedPosts();
  const size = Math.min(width, 720) / 3 - 2;
  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <View style={styles.cell}>
        <PostTile post={item} size={size} />
      </View>
    ),
    [size],
  );
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('set.savedPosts')} />
      <FlashList
        data={saved.items}
        numColumns={3}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={saved.isPending ? <RowsSkeleton rows={2} /> : <EmptyState icon={BookmarkSimple} message={t('set.savedEmpty')} />}
        onEndReached={saved.loadMore}
        ListFooterComponent={<ListFooter loading={saved.isFetchingNextPage} />}
      />
    </View>
  );
}

function Gap() {
  return <View style={{ height: 2 }} />;
}

export function BlockedScreen() {
  const t = useT();
  const colors = useColors();
  const blocks = useBlocks();
  const unblock = useBlock();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('set.blocked')} />
      <FlashList
        data={blocks.items}
        keyExtractor={(item) => item.user.id}
        renderItem={({ item }) => (
          <View style={[styles.blockRow, { backgroundColor: colors.surface, borderBottomColor: colors.divider }]}>
            <Avatar url={item.user.avatar_url} name={item.user.display_name ?? item.user.username} size={40} />
            <AppText variant="bodyStrong" style={styles.flex}>
              {item.user.username}
            </AppText>
            <Button label={t('common.unblock')} kind="secondary" size="sm" onPress={() => unblock.mutate({ userId: item.user.id, block: false })} />
          </View>
        )}
        ListEmptyComponent={blocks.isPending ? <RowsSkeleton rows={2} avatar /> : <EmptyState icon={Prohibit} message={t('set.blockedEmpty')} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingBottom: space.x5 },
  surface: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  choice: { paddingHorizontal: layout.screenPadding, paddingVertical: space.md, gap: space.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  icon: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pad: { paddingHorizontal: layout.screenPadding },
  cell: { paddingHorizontal: 1 },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
});
