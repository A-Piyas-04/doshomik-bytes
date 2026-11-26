import { Platform, type TextStyle } from 'react-native';

/** Web only: hide the browser's focus ring on our inputs (they draw their own focus border). */
export const noOutline: TextStyle = Platform.OS === 'web' ? { outlineWidth: 0 } : {};
