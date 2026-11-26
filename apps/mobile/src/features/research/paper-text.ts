import type { Lang } from '@/lib/prefs';
import { fieldName } from '../fields';
import type { CardContent, PaperCard, PaperDetail } from '@/api/types';

/** The card question in the app language, falling back to the other language, then the TLDR. */
export function paperQuestion(paper: Pick<PaperCard, 'question' | 'tldr'>, lang: Lang): string | null {
  const other = lang === 'bn' ? 'en' : 'bn';
  return paper.question[lang] ?? paper.question[other] ?? paper.tldr ?? null;
}

/** "Kaiming He, Xiangyu Zhang +2". */
export function shortAuthors(authors: string | null, moreLabel: (n: number) => string): string | null {
  if (!authors) return null;
  const names = authors.split(',').map((name) => name.trim()).filter((name) => name && name !== 'et al.');
  const etAl = /et al\.?$/.test(authors.trim());
  if (names.length <= 2 && !etAl) return names.join(', ');
  const rest = names.length - 2;
  return `${names.slice(0, 2).join(', ')} ${rest > 0 ? moreLabel(rest) : 'et al.'}`;
}

/** Which card to show: the app language if it exists, else the other one. */
export function pickCard(paper: PaperDetail, preferred: Lang): { lang: Lang; card: CardContent } | null {
  const order: Lang[] = preferred === 'bn' ? ['bn', 'en'] : ['en', 'bn'];
  for (const lang of order) {
    const card = paper.cards[lang];
    if (card) return { lang, card };
  }
  return null;
}

/** The meta line: field (in the app language) · venue or year. */
export function paperMeta(paper: Pick<PaperCard, 'field' | 'venue' | 'year'>, lang: Lang): string {
  const when = paper.venue ?? (paper.year ? String(paper.year) : null);
  return [fieldName(paper.field, lang), when].filter(Boolean).join(' · ');
}
