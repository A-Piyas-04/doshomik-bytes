import type { ReportReason, ReportTargetType } from '@doshomik/shared';
import { api } from '@/api/client';
import { queryClient } from '@/api/query';
import type { Post } from '@/api/types';
import { translate, type MessageKey } from '@/i18n';
import { copyLink, shareLink } from '@/lib/share';
import { confirm, showActions } from '@/ui/ActionSheet';
import { Flag, LinkGlyph, PaperPlaneTilt, Trash } from '@/ui/icons';
import { toast } from '@/ui/Toast';

const REASONS: ReportReason[] = ['spam', 'harassment', 'nudity', 'violence', 'misinformation', 'other'];

/** Report flow: pick a reason, send, thank. One sheet, no form. */
export function reportFlow(target_type: ReportTargetType, target_id: string) {
  showActions({
    title: translate('report.title'),
    actions: REASONS.map((reason) => ({
      label: translate(`report.${reason}` as MessageKey),
      onPress: () => {
        api
          .post('/reports', { target_type, target_id, reason })
          .then(() => toast(translate('report.sent')))
          .catch(() => toast(translate('common.actionFailed'), { tone: 'error' }));
      },
    })),
  });
}

/** The ⋯ menu of a post: share and copy for everyone, delete for the author, report for others. */
export function postMenu(post: Post, mine: boolean, onDelete: (id: string) => void) {
  showActions({
    actions: [
      { label: translate('common.share'), icon: PaperPlaneTilt, onPress: () => void shareLink(post.share_url) },
      { label: translate('common.copyLink'), icon: LinkGlyph, onPress: () => void copyLink(post.share_url) },
      mine
        ? {
            label: translate('post.delete'),
            icon: Trash,
            destructive: true,
            onPress: async () => {
              const ok = await confirm({ title: translate('post.deleteConfirm'), confirmLabel: translate('common.delete'), destructive: true });
              if (ok) onDelete(post.id);
            },
          }
        : { label: translate('common.report'), icon: Flag, destructive: true, onPress: () => reportFlow('post', post.id) },
    ],
  });
}

export const refreshEverything = () => queryClient.invalidateQueries();
