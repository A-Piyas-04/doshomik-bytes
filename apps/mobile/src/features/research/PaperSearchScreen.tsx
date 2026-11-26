import { noOutline } from '@/ui/noOutline';
import { FlashList } from '@shopify/flash-list';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { usePapers, useToggleSave } from '@/api/research';
import type { PaperCard } from '@/api/types';
import { useT } from '@/i18n';
import { usePrefs } from '@/lib/prefs';
import { go } from '@/shell/nav';
import { fontFamily } from '@/theme/fonts';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { ListFooter, SectionLabel } from '@/ui/Bits';
import { IconButton } from '@/ui/IconButton';
import { CaretLeft, MagnifyingGlass, X } from '@/ui/icons';
import { RowsSkeleton } from '@/ui/Skeleton';
import { EmptyState } from '@/ui/States';
import { Tap } from '@/ui/Tap';
import { hasBengali } from '@/lib/script';
import { ALL, FieldChips } from '../fields';
import { PaperRow as PaperRowLazy } from './PaperRow';
import { SurfaceDivider } from './TrailsScreen';

/** Paper search: title, authors and the card questions, in English and Bangla. Recent searches stay on the device. */
export function PaperSearchScreen() {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const recent = usePrefs((s) => s.recentPaperSearches);
  const remember = usePrefs((s) => s.rememberSearch);
  const forget = usePrefs((s) => s.forgetSearches);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState(ALL);
  const results = usePapers({ q: query || undefined, field: chip === ALL ? undefined : chip }, query.length > 0);
  const toggleSave = useToggleSave();
  const onSave = useCallback((id: string, save: boolean) => toggleSave.mutate({ id, save }), [toggleSave]);
  const renderItem = useCallback(({ item }: { item: PaperCard }) => <PaperRow2 paper={item} onSave={onSave} />, [onSave]);

  // Search as you type, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const submit = () => {
    if (text.trim()) remember('recentPaperSearches', text.trim());
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <IconButton icon={CaretLeft} label={t('a11y.back')} onPress={() => router.back()} />
        <View style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MagnifyingGlass size={18} color={colors.textTertiary} />
          <TextInput
            autoFocus
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            returnKeyType="search"
            placeholder={t('research.searchPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            accessibilityLabel={t('research.searchPapers')}
            style={[noOutline, styles.input, { color: colors.text, fontFamily: fontFamily('sans', 'regular', hasBengali(text) ? 'bengali' : 'latin') }]}
          />
          {text ? <IconButton icon={X} size={18} label={t('common.clear')} onPress={() => setText('')} /> : null}
        </View>
      </View>
      <FieldChips value={chip} onChange={setChip} style={styles.chips} />
      {!query ? (
        recent.length ? (
          <View>
            <SectionLabel label={t('research.recent')} action={t('common.clear')} onAction={() => forget('recentPaperSearches')} />
            {recent.map((item) => (
              <Tap key={item} feedback="fill" onPress={() => setText(item)} style={styles.recent}>
                <MagnifyingGlass size={16} color={colors.textTertiary} />
                <AppText variant="body">{item}</AppText>
              </Tap>
            ))}
          </View>
        ) : null
      ) : (
        <FlashList
          data={results.items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={SurfaceDivider}
          ListEmptyComponent={
            results.isPending ? <RowsSkeleton rows={3} /> : <EmptyState icon={MagnifyingGlass} message={t('research.noResults', { q: query })} />
          }
          onEndReached={results.loadMore}
          ListFooterComponent={<ListFooter loading={results.isFetchingNextPage} />}
        />
      )}
    </View>
  );
}

function PaperRow2({ paper, onSave }: { paper: PaperCard; onSave: (id: string, save: boolean) => void }) {
  const remember = usePrefs((s) => s.rememberSearch);
  return (
    <PaperRowLazy
      paper={paper}
      onOpen={(id) => {
        remember('recentPaperSearches', paper.title.slice(0, 60));
        go.paper(id);
      }}
      onToggleSave={onSave}
    />
  );
}


const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingRight: layout.screenPadding, paddingLeft: space.xs, height: 56 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 42, borderRadius: radius.sm, borderWidth: 1, paddingLeft: space.md },
  input: { flex: 1, fontSize: 15, height: 42, paddingVertical: 0 },
  chips: { flexGrow: 0, paddingVertical: space.sm },
  recent: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, minHeight: 48 },
});
