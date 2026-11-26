import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { NotoSansBengali_400Regular } from '@expo-google-fonts/noto-sans-bengali/400Regular';
import { NotoSansBengali_500Medium } from '@expo-google-fonts/noto-sans-bengali/500Medium';
import { NotoSansBengali_600SemiBold } from '@expo-google-fonts/noto-sans-bengali/600SemiBold';
import { NotoSansBengali_700Bold } from '@expo-google-fonts/noto-sans-bengali/700Bold';
import { SourceSerif4_400Regular } from '@expo-google-fonts/source-serif-4/400Regular';
import { SourceSerif4_400Regular_Italic } from '@expo-google-fonts/source-serif-4/400Regular_Italic';
import { SourceSerif4_600SemiBold } from '@expo-google-fonts/source-serif-4/600SemiBold';

/**
 * Fonts are loaded with useFonts on every platform so the family names are identical on Android,
 * iOS and web (the config plugin names them differently per platform). Each weight is its own
 * family: never combine these names with `fontWeight` (Android ignores or fakes it).
 *
 *   sans   Inter: interface text
 *   bangla Noto Sans Bengali: every Bengali run, UI or content
 *   serif  Source Serif 4: paper titles and paper-card reading text (it has no Bengali glyphs,
 *          so Bengali runs inside serif text fall back to the Bangla sans)
 *   mono   JetBrains Mono: metadata labels, step numbers, counts, code
 */
export const fontAssets = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  NotoSansBengali_400Regular,
  NotoSansBengali_500Medium,
  NotoSansBengali_600SemiBold,
  NotoSansBengali_700Bold,
  SourceSerif4_400Regular,
  SourceSerif4_400Regular_Italic,
  SourceSerif4_600SemiBold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
};

export type FontWeightName = 'regular' | 'medium' | 'semibold' | 'bold';
export type FontRole = 'sans' | 'serif' | 'mono';

const latin: Record<FontRole, Record<FontWeightName, string>> = {
  sans: { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' },
  serif: { regular: 'SourceSerif4_400Regular', medium: 'SourceSerif4_600SemiBold', semibold: 'SourceSerif4_600SemiBold', bold: 'SourceSerif4_600SemiBold' },
  mono: { regular: 'JetBrainsMono_400Regular', medium: 'JetBrainsMono_500Medium', semibold: 'JetBrainsMono_500Medium', bold: 'JetBrainsMono_500Medium' },
};

const bangla: Record<FontWeightName, string> = {
  regular: 'NotoSansBengali_400Regular',
  medium: 'NotoSansBengali_500Medium',
  semibold: 'NotoSansBengali_600SemiBold',
  bold: 'NotoSansBengali_700Bold',
};

export const serifItalic = 'SourceSerif4_400Regular_Italic';

export function fontFamily(role: FontRole, weight: FontWeightName, script: 'latin' | 'bengali'): string {
  return script === 'bengali' ? bangla[weight] : latin[role][weight];
}
