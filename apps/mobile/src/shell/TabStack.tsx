import { Stack } from 'expo-router/stack';
import { useColors } from '@/theme/theme';

/** The stack inside every tab. Screens draw their own headers (ScreenHeader) for full control. */
export function TabStack() {
  const colors = useColors();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />;
}
