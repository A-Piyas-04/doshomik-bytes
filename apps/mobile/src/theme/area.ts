import { useTheme } from './theme';
import { areaColor, personColor, type AreaColor } from './tokens';

/** The colour of a learn area, in the current theme. */
export function useArea(slug: string | null | undefined): AreaColor {
  const { scheme } = useTheme();
  return areaColor(slug, scheme);
}

/** A colour lookup for many areas at once (lists). */
export function useAreaPalette(): (slug: string | null | undefined) => AreaColor {
  const { scheme } = useTheme();
  return (slug) => areaColor(slug, scheme);
}

/**
 * How much colour a background behind text takes (the rest is the card surface). Full-strength
 * fills behind words were too loud (owner, 26 Nov 2026), so every coloured box that holds text uses
 * this wash, with black words: text posts, the paper and roadmap headers, the area spotlight,
 * course covers, path tiles and banners. Solid colour stays for controls and for glyphs.
 */
const WASH_STRENGTH = 0.24;

const HEX = /^#[0-9a-f]{6}$/i;

/** `color` laid over `base` at `amount` (0..1), as an opaque hex. Both are #RRGGBB. */
function mix(color: string, base: string, amount: number): string {
  if (!HEX.test(color) || !HEX.test(base)) return color;
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(channel(base, i) + (channel(color, i) - channel(base, i)) * amount));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The background of a text post (feed blocks, grid tiles): its area's colour softened onto the
 * card, plus the area's ink for its glyph (the words themselves are always the text colour). A
 * post with no topic keeps the neutral (light grey in the light theme).
 */
export function useTextPostPaint(slug: string | null | undefined): { bg: string; fg: string } {
  const { scheme, colors } = useTheme();
  const area = areaColor(slug, scheme);
  if (!slug) return { bg: area.solid, fg: area.on };
  return { bg: mix(area.solid, colors.surface, WASH_STRENGTH), fg: area.ink };
}

/** The wash of any colour (an area's solid, the accent, the highlight) for a box that holds text. */
export function useWash(): (color: string) => string {
  const { colors } = useTheme();
  return (color) => mix(color, colors.surface, WASH_STRENGTH);
}

export function usePersonColor(name: string): AreaColor {
  const { scheme } = useTheme();
  return personColor(name, scheme);
}
