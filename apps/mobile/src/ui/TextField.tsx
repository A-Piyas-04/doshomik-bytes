import type { ComponentRef, Ref } from 'react';
import { noOutline } from '@/ui/noOutline';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { hasBengali } from '@/lib/script';
import { fontFamily } from '@/theme/fonts';
import { useColors } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { AppText } from './AppText';

interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  /** Show "n / max" under the field. */
  counter?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}

/** Labelled input. Switches to the Bangla font while the text contains Bengali. */
export function TextField({ label, hint, error, counter, containerStyle, style, value, maxLength, multiline, ref, ...rest }: TextFieldProps) {
  const colors = useColors();
  const bengali = !!value && hasBengali(value);
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <AppText variant="label" tone="textSecondary">
          {label}
        </AppText>
      ) : null}
      <TextInput
        ref={ref}
        value={value}
        maxLength={maxLength}
        multiline={multiline}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        style={[noOutline, 
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            fontFamily: fontFamily('sans', 'regular', bengali ? 'bengali' : 'latin'),
            minHeight: multiline ? 96 : 44,
            lineHeight: bengali ? 24 : 21,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
        {...rest}
      />
      {error || hint || (counter && maxLength) ? (
        <View style={styles.below}>
          <AppText variant="caption" tone={error ? 'danger' : 'textTertiary'} style={styles.hint}>
            {error ?? hint ?? ''}
          </AppText>
          {counter && maxLength ? (
            <AppText variant="caption" tone="textTertiary">
              {`${value?.length ?? 0} / ${maxLength}`}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 15 },
  below: { flexDirection: 'row', gap: space.sm },
  hint: { flex: 1 },
});
