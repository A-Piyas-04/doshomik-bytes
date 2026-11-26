import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Platform, Share } from 'react-native';
import { translate } from '@/i18n';
import { brandColors } from '@/theme/tokens';
import { toast } from '@/ui/Toast';

/** The system share sheet; on web, the Web Share API or a copied link. */
export async function shareLink(url: string, title?: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      const nav = globalThis.navigator as Navigator & { share?: (data: { url: string; title?: string }) => Promise<void> };
      if (nav?.share) await nav.share({ url, title });
      else await copyLink(url);
      return;
    }
    await Share.share(Platform.OS === 'ios' ? { url, title } : { message: url, title });
  } catch {
    // The user closed the sheet.
  }
}

export async function copyLink(url: string): Promise<void> {
  await Clipboard.setStringAsync(url);
  toast(translate('common.copied'));
}

/** Outside links (papers, courses, code) open in an in-app browser tab (Custom Tabs on Android). */
export async function openExternal(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, { toolbarColor: brandColors.ink, controlsColor: brandColors.mint, showTitle: true, enableBarCollapsing: true });
  } catch {
    toast(translate('common.actionFailed'), { tone: 'error' });
  }
}

/** "youtube.com" from a URL, for "Watch on youtube.com". */
export function hostOf(url: string): string {
  const match = /^https?:\/\/(?:www\.)?([^/]+)/i.exec(url);
  return match?.[1] ?? url;
}
