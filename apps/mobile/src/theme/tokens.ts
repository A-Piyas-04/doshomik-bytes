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
    bg: '#F1F2EE',
    surface: '#FFFFFF',
    elevated: '#EAECE7',
    border: '#DCDFD8',
    divider: '#E4E7E1',
    text: '#15181E',
    textSecondary: '#4B5057',
    textTertiary: '#787D83',
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

/**
 * One vivid colour per learn area: the area's identity everywhere it appears (chips, badges, the
 * paper hero, course covers, coloured text posts, Explore tiles). `solid` is the fill, `on` the
 * text on it, `tint` a light wash, `ink` text on the wash. Areas added later cycle through
 * `extraAreas` by slug.
 */
export interface AreaColor {
  solid: string;
  on: string;
  tint: string;
  ink: string;
}

const AREAS_LIGHT: Record<string, AreaColor> = {
  'ml-fundamentals': { solid: '#0E9F7A', on: '#FFFFFF', tint: '#DDF4EC', ink: '#0B6E55' },
  'deep-learning': { solid: '#6A4CF5', on: '#FFFFFF', tint: '#ECE8FF', ink: '#4A2FC9' },
  'computer-vision': { solid: '#F0564A', on: '#FFFFFF', tint: '#FFE6E2', ink: '#B9342A' },
  transformers: { solid: '#F5A70F', on: '#1F1600', tint: '#FFF0CF', ink: '#8A5600' },
  llms: { solid: '#2A78F0', on: '#FFFFFF', tint: '#E2EDFF', ink: '#1956BB' },
};
const AREAS_DARK: Record<string, AreaColor> = {
  'ml-fundamentals': { solid: '#18B88E', on: '#06231B', tint: 'rgba(24,184,142,0.16)', ink: '#5FD6B2' },
  'deep-learning': { solid: '#7D63FF', on: '#FFFFFF', tint: 'rgba(125,99,255,0.18)', ink: '#B3A3FF' },
  'computer-vision': { solid: '#FF6A5E', on: '#2A0805', tint: 'rgba(255,106,94,0.16)', ink: '#FF9E95' },
  transformers: { solid: '#F7B32B', on: '#1F1600', tint: 'rgba(247,179,43,0.16)', ink: '#FFD27A' },
  llms: { solid: '#4A8CFF', on: '#FFFFFF', tint: 'rgba(74,140,255,0.18)', ink: '#9CC0FF' },
};
const EXTRA_LIGHT: AreaColor[] = [
  { solid: '#D9448E', on: '#FFFFFF', tint: '#FDE4F0', ink: '#A12A65' },
  { solid: '#0F8FB5', on: '#FFFFFF', tint: '#DDF2F9', ink: '#0A6683' },
];
const EXTRA_DARK: AreaColor[] = [
  { solid: '#EF5FA6', on: '#2A0517', tint: 'rgba(239,95,166,0.16)', ink: '#F7A3CC' },
  { solid: '#27A9CF', on: '#03202A', tint: 'rgba(39,169,207,0.16)', ink: '#86D3EA' },
];
/** Content with no area (a post without a topic): light grey with ink text, so it stays quiet. */
const NEUTRAL_LIGHT: AreaColor = { solid: '#E3E6E0', on: '#15181E', tint: '#ECEEEA', ink: '#3A4048' };
const NEUTRAL_DARK: AreaColor = { solid: '#3A3F48', on: '#F4F1E8', tint: '#282C34', ink: '#C9CBC6' };

function hash(text: string): number {
  let h = 0;
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return h;
}

/** The colour of a learn area (by field slug); neutral when there is no area. */
export function areaColor(slug: string | null | undefined, scheme: SchemeName): AreaColor {
  if (!slug) return scheme === 'dark' ? NEUTRAL_DARK : NEUTRAL_LIGHT;
  const known = (scheme === 'dark' ? AREAS_DARK : AREAS_LIGHT)[slug];
  if (known) return known;
  const extra = scheme === 'dark' ? EXTRA_DARK : EXTRA_LIGHT;
  return extra[hash(slug) % extra.length]!;
}

/** A stable colour for a person (avatar fallbacks), drawn from the area palette. */
export function personColor(name: string, scheme: SchemeName): AreaColor {
  const all = Object.values(scheme === 'dark' ? AREAS_DARK : AREAS_LIGHT);
  return all[hash(name) % all.length]!;
}

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
  /** The offline strip above the tab bar (toasts sit above it while it shows). */
  offlineStripHeight: 30,
  /** Readable measure for long text (paper summaries, lessons). */
  maxTextWidth: 640,
} as const;

/** Motion durations (ms). Springs only for the like pop and sheet drag. */
export const motion = { tap: 150, state: 200, screen: 260, loader: 220 } as const;
