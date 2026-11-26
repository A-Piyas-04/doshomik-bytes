import type { FontRole, FontWeightName } from './fonts';

/**
 * The type scale (project-context §2.3). `size` and `line` are Latin metrics; Bengali text gets the
 * taller `bnLine` because conjuncts and matras need vertical room. Never uppercase or track Bangla.
 */
export interface TextVariant {
  size: number;
  line: number;
  bnLine: number;
  role: FontRole;
  weight: FontWeightName;
  /** Letter spacing for Latin only. */
  tracking?: number;
  /** Uppercase for Latin only (labels). */
  upper?: boolean;
}

const scale = {
  /** Screen titles (Learn, Explore). */
  display: { size: 26, line: 32, bnLine: 40, role: 'sans', weight: 'bold', tracking: -0.4 },
  /** Paper title on the paper screen. */
  paperTitle: { size: 23, line: 29, bnLine: 38, role: 'serif', weight: 'semibold' },
  /** Section heads, sheet titles. */
  title: { size: 18, line: 24, bnLine: 30, role: 'sans', weight: 'bold', tracking: -0.2 },
  /** Paper titles in lists and cards. */
  paperRow: { size: 16, line: 21, bnLine: 27, role: 'serif', weight: 'semibold' },
  /** The paper's question; short text posts on colour. */
  lead: { size: 17, line: 24, bnLine: 30, role: 'sans', weight: 'semibold', tracking: -0.1 },
  /** Post text, captions, comments. */
  body: { size: 14, line: 20, bnLine: 25, role: 'sans', weight: 'regular' },
  /** Long reading text: paper sections, lessons. */
  reading: { size: 15, line: 23, bnLine: 27, role: 'sans', weight: 'regular' },
  /** Account names, row titles. */
  bodyStrong: { size: 14, line: 19, bnLine: 24, role: 'sans', weight: 'bold' },
  label: { size: 13, line: 18, bnLine: 22, role: 'sans', weight: 'medium' },
  caption: { size: 12, line: 16, bnLine: 20, role: 'sans', weight: 'regular' },
  /** Labels in mono, upper-case Latin. */
  meta: { size: 10.5, line: 13, bnLine: 17, role: 'mono', weight: 'medium', tracking: 0.8, upper: true },
  micro: { size: 11, line: 14, bnLine: 17, role: 'sans', weight: 'semibold' },
  mono: { size: 12, line: 17, bnLine: 20, role: 'mono', weight: 'regular' },
} satisfies Record<string, TextVariant>;

export type TypeName = keyof typeof scale;
export const type: Record<TypeName, TextVariant> = scale;
