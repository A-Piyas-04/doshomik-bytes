// phosphor-react-native's icon source (`src/lib/icon-base.tsx`, compiled with the app because the
// icons are imported one by one from `src/icons/`) passes `className` to <Svg> for NativeWind.
// react-native-svg 15.16's types don't declare it, which fails `tsc`. At runtime the prop is
// ignored on native. Remove this file once either package declares or drops it.
import 'react-native-svg';

declare module 'react-native-svg' {
  interface SvgProps {
    className?: string;
  }
}
