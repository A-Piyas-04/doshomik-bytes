import { useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFields, useInterests, useSetInterests } from '@/api/research';
import type { Ref } from '@/api/types';
import { useLang, useT } from '@/i18n';
import type { Lang } from '@/lib/prefs';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { ChipRow, type ChipOption } from '@/ui/Chips';
import { Check } from '@/ui/icons';
import { Tap } from '@/ui/Tap';

/**
 * The learn areas (`fields`) are one taxonomy across Research, Learn, Practice and Explore. Their
 * names come from the API in English; the five launch areas also have Bangla names here. An area
 * added later shows its API name until it gets one.
 */
const BANGLA_NAMES: Record<string, string> = {
  'ml-fundamentals': 'ML-এর ভিত্তি',
  'deep-learning': 'ডিপ লার্নিং',
  'computer-vision': 'কম্পিউটার ভিশন',
  transformers: 'ট্রান্সফর্মার',
  llms: 'LLM',
};

export function fieldName(field: Ref, lang: Lang): string {
  return lang === 'bn' ? (BANGLA_NAMES[field.slug] ?? field.name) : field.name;
}

export const ALL = 'all';
export const FOR_YOU = 'for-you';

/** The area chips: All, the areas in order, and "For you" first when the user picked interests. */
export function FieldChips({
  value,
  onChange,
  forYou,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  forYou?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  const lang = useLang();
  const fields = useFields();
  const options = useMemo(() => {
    const list: ChipOption<string>[] = [];
    if (forYou) list.push({ value: FOR_YOU, label: t('common.forYou') });
    list.push({ value: ALL, label: t('common.all') });
    for (const field of fields.data ?? []) list.push({ value: field.slug, label: fieldName(field, lang) });
    return list;
  }, [fields.data, forYou, lang, t]);
  return <ChipRow options={options} value={value} onChange={onChange} style={style} />;
}

/** "Pick the fields you care about": multi-select areas, saved as onboarding interests. */
export function InterestsSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved?: (fields: string[]) => void }) {
  const interests = useInterests();
  if (!visible || interests.isPending) return null;
  return <InterestsPicker initial={(interests.data ?? []).map((field) => field.slug)} onClose={onClose} onSaved={onSaved} />;
}

function InterestsPicker({ initial, onClose, onSaved }: { initial: string[]; onClose: () => void; onSaved?: (fields: string[]) => void }) {
  const t = useT();
  const lang = useLang();
  const colors = useColors();
  const fields = useFields();
  const save = useSetInterests();
  const [picked, setPicked] = useState<string[]>(initial);

  const toggle = (slug: string) => setPicked((current) => (current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug]));

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={t('int.title')}
      subtitle={t('int.hint')}
      footer={
        <Button
          label={t('common.save')}
          block
          disabled={picked.length === 0}
          loading={save.isPending}
          onPress={() =>
            save.mutate(picked, {
              onSuccess: () => {
                onSaved?.(picked);
                onClose();
              },
            })
          }
        />
      }
    >
      {(fields.data ?? []).map((field) => {
        const selected = picked.includes(field.slug);
        return (
          <Tap
            key={field.slug}
            feedback="fill"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            onPress={() => toggle(field.slug)}
            style={styles.row}
          >
            <View style={styles.text}>
              <AppText variant="bodyStrong">{fieldName(field, lang)}</AppText>
              {field.description ? (
                <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
                  {field.description}
                </AppText>
              ) : null}
            </View>
            <View
              style={[
                styles.box,
                { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accent : 'transparent' },
              ]}
            >
              {selected ? <Check size={14} weight="bold" color={colors.onAccent} /> : null}
            </View>
          </Tap>
        );
      })}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md, minHeight: 56 },
  text: { flex: 1, gap: 2 },
  box: { width: 22, height: 22, borderRadius: radius.xs, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
