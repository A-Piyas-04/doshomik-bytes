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
  /** Screen titles. */
  display: { size: 28, line: 34, bnLine: 44, role: 'sans', weight: 'bold', tracking: -0.3 },
  /** Paper title on the paper screen. */
  paperTitle: { size: 24, line: 31, bnLine: 40, role: 'serif', weight: 'semibold' },
  /** Section heads, sheet titles. */
  title: { size: 20, line: 26, bnLine: 34, role: 'sans', weight: 'semibold', tracking: -0.2 },
  /** Paper titles in lists. */
  paperRow: { size: 17, line: 23, bnLine: 29, role: 'serif', weight: 'semibold' },
  /** The question on a paper card: the one thing to notice first. */
  lead: { size: 18, line: 26, bnLine: 31, role: 'sans', weight: 'medium' },
  body: { size: 15, line: 22, bnLine: 26, role: 'sans', weight: 'regular' },
  /** Long reading text: paper sections, lessons. */
  reading: { size: 16, line: 25, bnLine: 28, role: 'sans', weight: 'regular' },
  bodyStrong: { size: 15, line: 22, bnLine: 26, role: 'sans', weight: 'semibold' },
  label: { size: 14, line: 20, bnLine: 24, role: 'sans', weight: 'medium' },
  caption: { size: 13, line: 18, bnLine: 22, role: 'sans', weight: 'regular' },
  /** Field labels, step numbers, counts: JetBrains Mono, upper-case Latin. */
  meta: { size: 11, line: 14, bnLine: 18, role: 'mono', weight: 'medium', tracking: 0.6, upper: true },
  micro: { size: 11, line: 14, bnLine: 18, role: 'sans', weight: 'medium' },
  mono: { size: 13, line: 19, bnLine: 22, role: 'mono', weight: 'regular' },
} satisfies Record<string, TextVariant>;

export type TypeName = keyof typeof scale;
export const type: Record<TypeName, TextVariant> = scale;
