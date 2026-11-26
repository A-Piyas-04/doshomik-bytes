import { Tabs } from 'expo-router/js-tabs';
import { BrandTabBar } from '@/shell/BrandTabBar';
import { useColors } from '@/theme/theme';

/** Home · Learn · Explore · Reels · Profile. Each tab has its own stack with shared screens. */
export default function TabsLayout() {
  const colors = useColors();
  return (
    <Tabs
      tabBar={(props) => <BrandTabBar {...props} />}
      backBehavior="history"
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="(home)" />
      <Tabs.Screen name="(learn)" />
      <Tabs.Screen name="(explore)" />
      <Tabs.Screen name="(reels)" />
      <Tabs.Screen name="(profile)" />
    </Tabs>
  );
}
