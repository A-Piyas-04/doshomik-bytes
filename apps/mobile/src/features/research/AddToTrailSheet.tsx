import { TRAIL_MAX_ITEMS } from '@doshomik/shared';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useAppendToTrail, useUserTrails } from '@/api/research';
import { useMe } from '@/api/social';
import type { TrailDetail } from '@/api/types';
import { translate, useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Tag } from '@/ui/Bits';
import { BottomSheet } from '@/ui/BottomSheet';
import { Path, Plus } from '@/ui/icons';
import { Tap } from '@/ui/Tap';
import { toast } from '@/ui/Toast';

/** Add a paper to one of my trails, or start a new trail with it. */
export function AddToTrailSheet({ paperId, visible, onClose }: { paperId: string; visible: boolean; onClose: () => void }) {
  const t = useT();
  const colors = useColors();
  const me = useMe();
  const trails = useUserTrails(visible ? me.data?.id : undefined);
  const append = useAppendToTrail();
  const [checking, setChecking] = useState<string | null>(null);

  const add = async (trailId: string) => {
    setChecking(trailId);
    try {
      const trail = await api.get<TrailDetail>(`/trails/${trailId}`);
      if (trail.steps.some((step) => step.paper.id === paperId)) return toast(translate('att.already'));
      if (trail.steps.length >= TRAIL_MAX_ITEMS) return toast(translate('att.full'));
      append.mutate({ trailId, paperId }, { onSuccess: onClose });
    } catch {
      toast(translate('common.actionFailed'), { tone: 'error' });
    } finally {
      setChecking(null);
    }
  };

  const mine = trails.items.filter((trail) => trail.status !== 'removed');
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('att.title')}>
      <Tap
        feedback="fill"
        onPress={() => {
          onClose();
          go.newTrail(paperId);
        }}
        style={styles.row}
      >
        <View style={[styles.icon, { borderColor: colors.accent }]}>
          <Plus size={20} color={colors.accent} weight="bold" />
        </View>
        <AppText variant="bodyStrong" tone="accent">
          {t('att.newWith')}
        </AppText>
      </Tap>
      {trails.isPending ? <ActivityIndicator style={styles.loading} color={colors.textTertiary} /> : null}
      {!trails.isPending && mine.length === 0 ? (
        <AppText variant="caption" tone="textSecondary" style={styles.none}>
          {t('att.none')}
        </AppText>
      ) : null}
      {mine.map((trail) => (
        <Tap key={trail.id} feedback="fill" onPress={() => void add(trail.id)} style={styles.row} disabled={!!checking}>
          <View style={[styles.icon, { borderColor: colors.border }]}>
            <Path size={20} color={colors.text} />
          </View>
          <View style={styles.text}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {trail.title}
            </AppText>
            <AppText variant="caption" tone="textSecondary">
              {t('trails.papers', { n: trail.paper_count })}
            </AppText>
          </View>
          {trail.status === 'draft' ? <Tag label={t('common.draft')} /> : null}
          {checking === trail.id || (append.isPending && append.variables?.trailId === trail.id) ? <ActivityIndicator color={colors.accent} /> : null}
        </Tap>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
  icon: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  loading: { padding: space.lg },
  none: { paddingHorizontal: layout.screenPadding, paddingVertical: space.md },
});
