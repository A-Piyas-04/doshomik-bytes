import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { usePrefs } from '@/lib/prefs';
import { palettes, type Palette, type SchemeName } from './tokens';

interface Theme {
  scheme: SchemeName;
  colors: Palette;
}

const ThemeContext = createContext<Theme>({ scheme: 'dark', colors: palettes.dark });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = usePrefs((s) => s.theme);
  const system = useColorScheme();
  const scheme: SchemeName = preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;
  const value = useMemo(() => ({ scheme, colors: palettes[scheme] }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;
