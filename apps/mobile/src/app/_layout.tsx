import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationTheme } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { persistOptions, queryClient, wireQueryManagers } from '@/api/query';
import { loadPrefs, usePrefs } from '@/lib/prefs';
import { AppLoader } from '@/shell/AppLoader';
import { fontAssets } from '@/theme/fonts';
import { ThemeProvider, useTheme } from '@/theme/theme';
import { ActionSheetHost } from '@/ui/ActionSheet';
import { KeyboardRoot } from '@/ui/Keyboard';
import { ToastHost } from '@/ui/Toast';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Deep links land on top of the tabs, so Back always has somewhere to go. */
export const unstable_settings = { anchor: '(tabs)' };

function RootStack() {
  const { scheme, colors } = useTheme();
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: colors.bg, card: colors.bg, border: colors.border, text: colors.text, primary: colors.accent } };
  }, [scheme, colors]);

  return (
    <NavigationTheme value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="create" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="trail-editor" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="edit-profile" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="reel/[id]" options={{ animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="viewer" options={{ presentation: 'transparentModal', animation: 'fade' }} />
      </Stack>
      <ToastHost />
      <ActionSheetHost />
    </NavigationTheme>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const prefsLoaded = usePrefs((s) => s.hydrated);
  const [cacheRestored, setCacheRestored] = useState(false);

  useEffect(() => {
    void loadPrefs();
    return wireQueryManagers();
  }, []);

  // A font that fails to load must not block the app: the system font stands in.
  const ready = (fontsLoaded || !!fontError) && prefsLoaded && cacheRestored;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions} onSuccess={() => setCacheRestored(true)} onError={() => setCacheRestored(true)}>
          <ThemeProvider>
            <KeyboardRoot>
              {prefsLoaded && (fontsLoaded || fontError) ? <RootStack /> : null}
              <AppLoader ready={ready} />
            </KeyboardRoot>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
