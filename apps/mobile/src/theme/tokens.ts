/**
 * Design tokens. Every colour, size and radius in the app comes from here; components never use
 * literals.
 *
 * Colour theme: the owner's mockups (2026-11-26). Light-first: a warm light-grey page, white
 * surfaces, near-black ink text, a deep teal primary, mint-wash tags, and amber as the second
 * accent (active-tab dot, badges, highlights). The dark theme uses the same hues on the logo's ink.
 */

export type SchemeName = 'dark' | 'light';

export interface Palette {
  /** Page background (between cards and rows). */
  bg: string;
  /** Cards, rows, inputs, sheets: the white layer on the grey page. */
  surface: string;
  /** Pressed states, skeleton blocks, the language switch track. */
  elevated: string;
  border: string;
  /** Hairlines between list rows. */
  divider: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Deep teal: primary actions, links, filled bookmarks, progress, the reading dots. */
  accent: string;
  /** Text and icons on an accent fill. */
  onAccent: string;
  /** Mint wash behind accent tags ("#MLBasics", "Read") and selected rows. */
  accentWash: string;
  /** Amber, the second accent: active-tab dot, "New"/"Trending" badges, highlight text on ink. */
  highlight: string;
  highlightWash: string;
  highlightText: string;
  /** Ink blocks: the selected chip, the "Up next" banner. */
  inverse: string;
  onInverse: string;
  /** The "Up next" banner: ink on the light page, a raised block on the dark one. */
  banner: string;
  onBanner: string;
  like: string;
  danger: string;
  warning: string;
  success: string;
  /** Unread notification dot (coral). */
  alert: string;
  scrim: string;
}

const brand = {
  ink: '#16191F',
  cream: '#F4F1E8',
  mint: '#5BC9A1',
  teal: '#12755E',
  amber: '#F2A20C',
};

export const palettes: Record<SchemeName, Palette> = {
  light: {
    bg: '#F3F4F1',
    surface: '#FFFFFF',
    elevated: '#ECEEEA',
    border: '#E2E4DF',
    divider: '#ECEEEA',
    text: '#15181E',
    textSecondary: '#50555C',
    textTertiary: '#7B8086',
    accent: brand.teal,
    onAccent: '#FFFFFF',
    accentWash: '#DDF1E9',
    highlight: brand.amber,
    highlightWash: '#FCEFD4',
    highlightText: '#8A5600',
    inverse: brand.ink,
    onInverse: '#FFFFFF',
    banner: brand.ink,
    onBanner: '#FFFFFF',
    like: '#E5484D',
    danger: '#D33A40',
    warning: '#B26A00',
    success: brand.teal,
    alert: '#EF5350',
    scrim: 'rgba(21, 24, 30, 0.45)',
  },
  dark: {
    bg: brand.ink,
    surface: '#1E2128',
    elevated: '#282C34',
    border: '#30343D',
    divider: '#262A31',
    text: brand.cream,
    textSecondary: '#ABADA8',
    textTertiary: '#808480',
    accent: brand.mint,
    onAccent: brand.ink,
    accentWash: 'rgba(91, 201, 161, 0.14)',
    highlight: '#F5A524',
    highlightWash: 'rgba(245, 165, 36, 0.16)',
    highlightText: '#F6B84A',
    inverse: brand.cream,
    onInverse: brand.ink,
    banner: '#262B35',
    onBanner: brand.cream,
    like: '#F2545B',
    danger: '#EF5A5F',
    warning: '#F5A524',
    success: brand.mint,
    alert: '#F2545B',
    scrim: 'rgba(8, 9, 12, 0.62)',
  },
};

/** The colours of the logo itself, for the loading screen and splash. */
export const brandColors = brand;

/** 4 dp grid. Nothing uses an off-scale value. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, x3: 32, x4: 40, x5: 48 } as const;

/** Small radii on purpose: blocks 12, buttons and chips 8, badges 4. No pills; only avatars are circles. */
export const radius = { xs: 4, sm: 8, md: 12, lg: 14, sheet: 18, full: 999 } as const;

export const hairline = 1;

/** Touch targets are at least this, even when the glyph is 20 dp. */
export const minTouch = 44;

export const layout = {
  screenPadding: 16,
  headerHeight: 52,
  tabBarHeight: 58,
  /** Readable measure for long text (paper summaries, lessons). */
  maxTextWidth: 640,
} as const;

/** Motion durations (ms). Springs only for the like pop and sheet drag. */
export const motion = { tap: 150, state: 200, screen: 260, loader: 220 } as const;
