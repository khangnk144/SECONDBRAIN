/**
 * Which language an AI answer is written in: the language of the question, with the UI language
 * as the tie-break (SPEC F19, F33). Vietnamese letters decide at once; text typed without
 * diacritics is judged by a few very common words of each language.
 */
import { foldForMatch } from '../../markdown/normalize-text.js';

export type AnswerLanguage = 'vi' | 'en';

/** Letters only Vietnamese uses among the two languages (precomposed, NFC). */
const VIETNAMESE_LETTER = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu;
const VIETNAMESE_WORDS = new Set([
  'khong',
  'gi',
  'nao',
  'cua',
  'toi',
  'minh',
  'ban',
  'nhung',
  'cac',
  'duoc',
  'voi',
  'tuan',
  'ngay',
  'hom',
  'nay',
  'mai',
  'viec',
  'han',
  'la',
  'va',
  'co',
  've',
  'cho',
  'nhu',
  'the',
]);
const ENGLISH_WORDS = new Set([
  'the',
  'what',
  'which',
  'how',
  'is',
  'are',
  'do',
  'does',
  'my',
  'me',
  'i',
  'this',
  'week',
  'due',
  'summarize',
  'explain',
  'about',
  'of',
  'in',
  'for',
  'to',
  'and',
  'you',
  'have',
  'next',
  'today',
  'tomorrow',
  'why',
  'when',
  'where',
  'who',
  'can',
  'please',
]);

export function toAnswerLanguage(value: unknown): AnswerLanguage {
  return value === 'en' ? 'en' : 'vi';
}

export function detectLanguage(text: string, uiLanguage: AnswerLanguage): AnswerLanguage {
  const nfc = text.normalize('NFC');
  if (VIETNAMESE_LETTER.test(nfc)) return 'vi';
  let vi = 0;
  let en = 0;
  for (const word of foldForMatch(nfc).match(/\p{L}+/gu) ?? []) {
    // `the` is a Vietnamese word too ("thế" typed without marks); it counts for neither.
    if (word === 'the') continue;
    if (VIETNAMESE_WORDS.has(word)) vi += 1;
    if (ENGLISH_WORDS.has(word)) en += 1;
  }
  if (vi === en) return uiLanguage;
  return vi > en ? 'vi' : 'en';
}
