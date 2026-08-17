import { analyzeSubtitle, tokenize } from '../src/core/analyzer.js';
import { dictionaryRegistry, DEFAULT_DICTIONARY_ID } from '../src/core/dictionary.js';
import { lemmatizer } from '../src/core/lemmatizer.js';
import { registerBncDictionary } from '../src/dictionary/bnc.js';

registerBncDictionary();
const dict = dictionaryRegistry.get(DEFAULT_DICTIONARY_ID)!;

const samples = [
  'This is a test. The running man ran quickly to the river and drank some water.',
  'Today I watched an interesting video about the history of photography.',
  'Unprepossessing xylophone the antidisestablishmentarianism quixotic.',
];

for (const text of samples) {
  const a = analyzeSubtitle(text, dict, lemmatizer);
  const unknownLemmas: string[] = [];
  const seen = new Set<string>();
  for (const t of tokenize(text)) {
    if (seen.has(t)) continue;
    seen.add(t);
    const found =
      dict.lookup(t) ?? lemmatizer.lemmatize(t).map((l) => dict.lookup(l)).find((e) => e !== null) ?? null;
    if (!found) unknownLemmas.push(t);
  }
  console.log(JSON.stringify({
    text,
    totalTokens: a.totalTokens,
    uniqueLemmas: a.uniqueLemmas,
    unknownTokens: a.unknownTokens,
    unknownLemmas,
    recommended: a.requiredVocab.recommended,
    coverageTop: a.coverageByRank[a.coverageByRank.length - 1]?.cumulative,
    note: a.requiredVocab.note,
  }, null, 0));
}

const dictList = dictionaryRegistry.list();
console.log('dictionaries:', dictList.map((d) => d.name).join(', '));
const entry = dict.lookup('river');
console.log('lookup river ->', JSON.stringify(entry));
console.log('lookup qxwzq ->', dict.lookup('qxwzq'));
