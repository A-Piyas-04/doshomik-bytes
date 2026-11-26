import { Children, isValidElement, memo, type ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { splitScripts } from '@/lib/script';
import { fontFamily, serifItalic, type FontWeightName } from '@/theme/fonts';
import { useColors } from '@/theme/theme';
import type { Palette } from '@/theme/tokens';
import { type, type TypeName } from '@/theme/typography';

export interface AppTextProps extends Omit<TextProps, 'children'> {
  variant?: TypeName;
  tone?: keyof Palette;
  weight?: FontWeightName;
  italic?: boolean;
  align?: TextStyle['textAlign'];
  children?: ReactNode;
}

/** Plain text content, or null when children include elements (nested Text). */
function plainText(children: ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  const parts = Children.toArray(children);
  if (parts.length && parts.every((part) => typeof part === 'string' || typeof part === 'number')) return parts.join('');
  if (parts.some(isValidElement)) return null;
  return parts.length ? parts.join('') : '';
}

/**
 * The only text component. It picks the font per script: Bengali runs get Noto Sans Bengali and a
 * taller line height, Latin runs the variant's family (Inter, Source Serif or JetBrains Mono).
 * Mixed strings are split into nested runs so "Transformer-এর attention" renders both scripts
 * properly. Upper-casing and letter-spacing apply to Latin only; Bangla has no case.
 */
export const AppText = memo(function AppText({
  variant = 'body',
  tone = 'text',
  weight,
  italic,
  align,
  style,
  children,
  maxFontSizeMultiplier = 2,
  ...rest
}: AppTextProps) {
  const colors = useColors();
  const v = type[variant];
  const w = weight ?? v.weight;
  const text = plainText(children);

  const latinFamily = italic && v.role === 'serif' ? serifItalic : fontFamily(v.role, w, 'latin');
  const base: TextStyle = { fontSize: v.size, color: colors[tone], textAlign: align };

  if (text === null) {
    // Nested elements (inline links, bold spans): the outer text sets Latin metrics.
    return (
      <Text {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[base, { fontFamily: latinFamily, lineHeight: v.line }, style]}>
        {children}
      </Text>
    );
  }

  const runs = splitScripts(text);
  const anyBengali = runs.some((run) => run.bengali);
  const allBengali = anyBengali && runs.every((run) => run.bengali);
  const latin = (value: string) => (v.upper ? value.toUpperCase() : value);
  const outer: TextStyle = {
    ...base,
    lineHeight: anyBengali ? v.bnLine : v.line,
    letterSpacing: anyBengali ? 0 : (v.tracking ?? 0),
    fontFamily: allBengali ? fontFamily(v.role, w, 'bengali') : latinFamily,
  };

  if (runs.length <= 1) {
    return (
      <Text {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[outer, style]}>
        {allBengali ? text : latin(text)}
      </Text>
    );
  }

  const bengaliFamily = fontFamily(v.role, w, 'bengali');
  return (
    <Text {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[outer, style]}>
      {runs.map((run, index) =>
        run.bengali ? (
          <Text key={index} style={{ fontFamily: bengaliFamily }}>
            {run.text}
          </Text>
        ) : (
          <Text key={index} style={{ fontFamily: latinFamily }}>
            {latin(run.text)}
          </Text>
        ),
      )}
    </Text>
  );
});
