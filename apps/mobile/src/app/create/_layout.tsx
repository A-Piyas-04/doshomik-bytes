import { Stack } from 'expo-router/stack';
import { useColors } from '@/theme/theme';

/** Create flows: full screen, no swipe-to-dismiss (a draft is never thrown away silently). */
export default function CreateLayout() {
  const colors = useColors();
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: colors.surface } }} />;
}
