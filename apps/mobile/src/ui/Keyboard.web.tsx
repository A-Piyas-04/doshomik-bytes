import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** Web: the browser handles the keyboard. */
export function KeyboardRoot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function KeyboardView({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle>; offset?: number }) {
  return <View style={[{ flex: 1 }, style]}>{children}</View>;
}
