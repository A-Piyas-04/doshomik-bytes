/**
 * Bangla/English script handling. Text in this app mixes scripts freely
 * ("Transformer-এর attention mechanism"), and each script needs its own font and line height.
 */

/** Bengali block, plus ZWNJ/ZWJ (conjunct control) and the dandas, which must stay inside Bengali runs. */
const BENGALI_CHAR = /[ঀ-৿‌‍।॥]/;
const BENGALI_ANY = /[ঀ-৿]/;
/** Characters with no script of their own: they join whichever run they sit in. */
const NEUTRAL = /[\s\d.,:;!?'"“”‘’()[\]{}\-–—/\\|+*=<>%&@#…·•→←×÷√^_~`]/;

export function hasBengali(text: string): boolean {
  return BENGALI_ANY.test(text);
}

export interface ScriptRun {
  text: string;
  bengali: boolean;
}

const cache = new Map<string, ScriptRun[]>();
const CACHE_LIMIT = 400;

/**
 * Splits text into runs of one script. Neutral characters (spaces, digits, punctuation) stay with
 * the run they are in, so a run boundary only falls where the script really changes.
 */
export function splitScripts(text: string): ScriptRun[] {
  const hit = cache.get(text);
  if (hit) return hit;

  const runs: ScriptRun[] = [];
  let current = '';
  let currentBengali: boolean | null = null;
  for (const char of text) {
    if (NEUTRAL.test(char)) {
      current += char;
      continue;
    }
    const bengali = BENGALI_CHAR.test(char);
    if (currentBengali === null) currentBengali = bengali;
    if (bengali !== currentBengali) {
      runs.push({ text: current, bengali: currentBengali });
      current = '';
      currentBengali = bengali;
    }
    current += char;
  }
  if (current) runs.push({ text: current, bengali: currentBengali ?? false });

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(text, runs);
  return runs;
}
