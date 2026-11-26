import { unwrapDevLaunchURL } from 'expo-linking';
import { rewriteSystemPath } from '@/shell/deep-links';

/**
 * Every link that opens the app passes through here on Android and iOS (not web). The rules live
 * in `src/shell/deep-links.ts`: share links map to app routes, and cold starts open in the tab the
 * content belongs to. Anything else passes through unchanged. It must never throw: a throw here
 * crashes the app on launch.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    return rewriteSystemPath(unwrapDevLaunchURL(path), initial) ?? path;
  } catch {
    return path;
  }
}
