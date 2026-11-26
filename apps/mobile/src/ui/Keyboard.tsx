import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';

/**
 * Keyboard handling under Android edge-to-edge (where adjustResize no longer moves content):
 * react-native-keyboard-controller. The .web.tsx twin is a plain passthrough.
 */
export function KeyboardRoot({ children }: { children: ReactNode }) {
  return <KeyboardProvider>{children}</KeyboardProvider>;
}

export function KeyboardView({ children, style, offset = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; offset?: number }) {
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} style={[{ flex: 1 }, style]}>
      {children}
    </KeyboardAvoidingView>
  );
}
