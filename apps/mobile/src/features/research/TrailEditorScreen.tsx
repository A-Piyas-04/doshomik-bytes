import { noOutline } from '@/ui/noOutline';
import { TRAIL_MAX_ITEMS, type ContentLang } from '@doshomik/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/api/client';
import { useCreateTrail, useMyPapers, usePaper, usePapers, useSaveTrail, useTrail, type TrailInput } from '@/api/research';
import type { PaperCard } from '@/api/types';
import { translate, useLang, useT } from '@/i18n';
import { hasBengali } from '@/lib/script';
import { fontFamily } from '@/theme/fonts';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { confirm } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { SectionLabel } from '@/ui/Bits';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { ChipRow } from '@/ui/Chips';
import { IconButton } from '@/ui/IconButton';
import { ArrowDown, ArrowUp, Check, MagnifyingGlass, Plus, X } from '@/ui/icons';
import { KeyboardView } from '@/ui/Keyboard';
import { Tap } from '@/ui/Tap';
import { TextField } from '@/ui/TextField';
import { toast } from '@/ui/Toast';
import { fieldName } from '../fields';
import { useFields } from '@/api/research';
import { paperMeta } from './paper-text';

interface Item {
  paper: Pick<PaperCard, 'id' | 'title' | 'field' | 'venue' | 'year'>;
  note: string;
}

const NO_FIELD = 'none';

/**
 * Make or edit a trail: a title, a short description, its language and (optionally) its field,
 * then the papers in order, each with a line on why it is there. Save as a draft at any time;
 * publishing needs two papers. Leaving with unsaved changes asks first.
 */
interface Initial {
  title: string;
  description: string;
  lang: ContentLang;
  field: string;
  items: Item[];
}

export function TrailEditorScreen({ id, initialPaper }: { id?: string; initialPaper?: string }) {
  const lang = useLang();
  const colors = useColors();
  const existing = useTrail(id);
  const seed = usePaper(initialPaper ?? '', !!initialPaper);
  if ((id && existing.isPending) || (initialPaper && seed.isPending)) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  // The form starts from the trail being edited, or from the paper it was started with.
  const trail = existing.data;
  const initial: Initial =
    id && trail
      ? {
          title: trail.title,
          description: trail.description ?? '',
          lang: trail.lang,
          field: trail.field?.slug ?? NO_FIELD,
          items: trail.steps.map((step) => ({ paper: step.paper, note: step.note ?? '' })),
        }
      : { title: '', description: '', lang, field: seed.data?.field.slug ?? NO_FIELD, items: seed.data ? [{ paper: seed.data, note: '' }] : [] };
  return <TrailEditorForm id={id} initial={initial} />;
}

function TrailEditorForm({ id, initial }: { id?: string; initial: Initial }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const fields = useFields();
  const create = useCreateTrail();
  const save = useSaveTrail(id ?? '');
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [trailLang, setTrailLang] = useState<ContentLang>(initial.lang);
  const [field, setField] = useState<string>(initial.field);
  const [items, setItems] = useState<Item[]>(initial.items);
  const [picking, setPicking] = useState(false);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [dirty, setDirty] = useState(false);

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setDirty(true);
    setter(value);
  };

  const input = (): TrailInput | null => {
    if (!title.trim()) {
      setTitleError(t('te.titleRequired'));
      return null;
    }
    return {
      title: title.trim(),
      description: description.trim() || null,
      lang: trailLang,
      field: field === NO_FIELD ? null : field,
      items: items.map((item) => ({ paper_id: item.paper.id, note: item.note.trim() || null })),
    };
  };

  const submit = (publish: boolean) => {
    const value = input();
    if (!value) return;
    const done = (trailId: string) => {
      setDirty(false);
      toast(translate(publish ? 'trails.published' : 'trails.savedDraft'));
      if (id) router.back();
      else router.replace({ pathname: '/trail/[id]', params: { id: trailId } });
    };
    const fail = (error: unknown) =>
      toast(error instanceof ApiError && error.code === 'TRAIL_TOO_SHORT' ? translate('te.minHint') : translate('common.actionFailed'), { tone: 'error' });
    if (id) save.mutate({ input: value, status: publish ? 'published' : 'draft' }, { onSuccess: (trail) => done(trail.id), onError: fail });
    else create.mutate({ input: value, publish }, { onSuccess: (trail) => done(trail.id), onError: fail });
  };

  const cancel = async () => {
    if (dirty) {
      const ok = await confirm({ title: t('te.discardTitle'), confirmLabel: t('common.discard'), destructive: true });
      if (!ok) return;
    }
    router.back();
  };

  const move = (index: number, by: -1 | 1) =>
    change(setItems)(
      (() => {
        const next = [...items];
        const [item] = next.splice(index, 1);
        next.splice(index + by, 0, item!);
        return next;
      })(),
    );

  const busy = create.isPending || save.isPending;
  const fieldOptions = useMemo(
    () => [{ value: NO_FIELD, label: t('te.fieldNone') }, ...(fields.data ?? []).map((f) => ({ value: f.slug, label: fieldName(f, lang) }))],
    [fields.data, lang, t],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <Button label={t('common.cancel')} kind="ghost" size="sm" onPress={() => void cancel()} />
        <AppText variant="bodyStrong" style={styles.headerTitle} numberOfLines={1}>
          {id ? t('te.editTitle') : t('te.newTitle')}
        </AppText>
        <Button label={t('te.saveDraft')} kind="ghost" size="sm" onPress={() => submit(false)} disabled={busy} />
      </View>
      <KeyboardView>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <TextField
              label={t('te.name')}
              value={title}
              onChangeText={(value) => {
                setTitleError(undefined);
                change(setTitle)(value);
              }}
              placeholder={t('te.namePlaceholder')}
              maxLength={120}
              error={titleError}
            />
            <TextField
              label={t('te.description')}
              value={description}
              onChangeText={change(setDescription)}
              placeholder={t('te.descriptionPlaceholder')}
              maxLength={500}
              counter
              multiline
            />
            <View style={styles.inline}>
              <AppText variant="label" tone="textSecondary">
                {t('te.language')}
              </AppText>
              <ChipRow
                wrap
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'bn', label: 'বাংলা' },
                ]}
                value={trailLang}
                onChange={change(setTrailLang)}
              />
            </View>
          </View>
          <View style={styles.inline}>
            <AppText variant="label" tone="textSecondary" style={styles.pad}>
              {t('te.field')}
            </AppText>
            <ChipRow options={fieldOptions} value={field} onChange={change(setField)} style={styles.flexNone} />
          </View>

          <SectionLabel label={`${t('te.steps')} · ${items.length}/${TRAIL_MAX_ITEMS}`} />
          <View style={[styles.steps, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {items.map((item, index) => (
              <View key={item.paper.id} style={[styles.step, index > 0 ? { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth } : null]}>
                <View style={styles.stepHead}>
                  <AppText variant="mono" tone="accent" style={styles.stepNumber}>
                    {String(index + 1).padStart(2, '0')}
                  </AppText>
                  <View style={styles.flex}>
                    <AppText variant="paperRow" numberOfLines={2}>
                      {item.paper.title}
                    </AppText>
                    <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
                      {paperMeta(item.paper, lang)}
                    </AppText>
                  </View>
                </View>
                <TextInput
                  value={item.note}
                  onChangeText={(note) => change(setItems)(items.map((it, i) => (i === index ? { ...it, note } : it)))}
                  placeholder={t('te.notePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  maxLength={280}
                  multiline
                  accessibilityLabel={t('te.notePlaceholder')}
                  style={[noOutline, 
                    styles.note,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg, fontFamily: fontFamily('sans', 'regular', hasBengali(item.note) ? 'bengali' : 'latin') },
                  ]}
                />
                <View style={styles.stepActions}>
                  <IconButton icon={ArrowUp} size={20} label={t('te.moveUp')} disabled={index === 0} onPress={() => move(index, -1)} />
                  <IconButton icon={ArrowDown} size={20} label={t('te.moveDown')} disabled={index === items.length - 1} onPress={() => move(index, 1)} />
                  <View style={styles.flex} />
                  <IconButton icon={X} size={20} tone="danger" label={t('te.remove')} onPress={() => change(setItems)(items.filter((_, i) => i !== index))} />
                </View>
              </View>
            ))}
            <Tap
              feedback="fill"
              disabled={items.length >= TRAIL_MAX_ITEMS}
              onPress={() => setPicking(true)}
              style={[styles.add, items.length ? { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth } : null]}
            >
              <Plus size={18} color={colors.accent} weight="bold" />
              <AppText variant="bodyStrong" tone="accent">
                {t('te.addPaper')}
              </AppText>
            </Tap>
          </View>
          <AppText variant="caption" tone="textTertiary" style={styles.hint}>
            {items.length >= TRAIL_MAX_ITEMS ? t('te.maxHint', { n: TRAIL_MAX_ITEMS }) : items.length < 2 ? t('te.minHint') : ''}
          </AppText>
        </ScrollView>
        <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + space.sm }]}>
          <Button label={t('common.publish')} block disabled={items.length < 2} loading={busy} onPress={() => submit(true)} />
        </View>
      </KeyboardView>
      <PaperPicker
        visible={picking}
        onClose={() => setPicking(false)}
        chosen={items.map((item) => item.paper.id)}
        onPick={(paper) => change(setItems)([...items, { paper, note: '' }])}
      />
    </View>
  );
}

/** Add a paper: saved papers first (the likely picks), then a search over the collection. */
function PaperPicker({ visible, onClose, chosen, onPick }: { visible: boolean; onClose: () => void; chosen: string[]; onPick: (paper: PaperCard) => void }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const saved = useMyPapers('saved');
  const results = usePapers({ q: query || undefined }, visible && query.length > 0);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const list = query ? results.items : saved.items;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('te.pickPaper')} maxHeight="90%">
      <View style={[styles.search, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <MagnifyingGlass size={18} color={colors.textTertiary} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('research.searchPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={t('research.searchPapers')}
          style={[noOutline, styles.searchInput, { color: colors.text, fontFamily: fontFamily('sans', 'regular', hasBengali(text) ? 'bengali' : 'latin') }]}
        />
      </View>
      {!query ? <SectionLabel label={t('te.fromSaved')} /> : null}
      {(query ? results.isPending : saved.isPending) ? <ActivityIndicator color={colors.textTertiary} style={styles.pickerLoading} /> : null}
      {list.map((paper) => {
        const added = chosen.includes(paper.id);
        return (
          <Tap key={paper.id} feedback="fill" disabled={added} onPress={() => onPick(paper)} style={styles.pick} accessibilityState={{ disabled: added }}>
            <View style={styles.flex}>
              <AppText variant="bodyStrong" numberOfLines={2}>
                {paper.title}
              </AppText>
              <AppText variant="caption" tone="textTertiary" numberOfLines={1}>
                {paperMeta(paper, lang)}
              </AppText>
            </View>
            {added ? (
              <View style={styles.added}>
                <Check size={16} color={colors.accent} weight="bold" />
                <AppText variant="caption" tone="accent">
                  {t('te.added')}
                </AppText>
              </View>
            ) : (
              <Plus size={20} color={colors.accent} />
            )}
          </Tap>
        );
      })}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  flexNone: { flexGrow: 0 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { flex: 1, textAlign: 'center' },
  scroll: { paddingBottom: space.x4 },
  form: { padding: layout.screenPadding, gap: space.lg },
  inline: { gap: space.sm },
  pad: { paddingHorizontal: layout.screenPadding },
  steps: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  step: { paddingHorizontal: layout.screenPadding, paddingTop: space.lg, paddingBottom: space.xs, gap: space.md },
  stepHead: { flexDirection: 'row', gap: space.md },
  stepNumber: { width: 24, paddingTop: 3 },
  note: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 14, minHeight: 44, marginLeft: 36 },
  stepActions: { flexDirection: 'row', marginLeft: 24 },
  add: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: layout.screenPadding, minHeight: 52 },
  hint: { paddingHorizontal: layout.screenPadding, paddingTop: space.sm },
  footer: { paddingHorizontal: layout.screenPadding, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: layout.screenPadding, height: 42, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: space.md },
  searchInput: { flex: 1, fontSize: 15, height: 42, paddingVertical: 0 },
  pickerLoading: { padding: space.lg },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  added: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
