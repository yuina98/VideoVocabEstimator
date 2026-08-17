/**
 * 测量工具：用扩展同一条流水线估算一段文本的词汇量要求。
 *
 * 用法：npm run measure -- <文本文件>
 */
import { readFileSync } from 'node:fs';
import { analyzeSubtitle } from '../src/core/analyzer.js';
import { dictionaryRegistry } from '../src/core/dictionary.js';
import { registerBncDictionary } from '../src/dictionary/bnc.js';
import { lemmatizer } from '../src/core/lemmatizer.js';

registerBncDictionary();
const dict = dictionaryRegistry.get('bnc');

const path = process.argv[2];
if (!path) {
  console.error('用法: npm run measure -- <文本文件>');
  process.exit(1);
}
const a = analyzeSubtitle(readFileSync(path, 'utf8'), dict, lemmatizer);
const r = a.requiredVocab;
const graded = a.totalTokens - a.basewrdTokens - a.unknownTokens;

console.log('词表: BNC/COCA 25k（词族 + 专有名词）');
console.log(`总词数(token): ${a.totalTokens}`);
console.log(`  分级词: ${graded}`);
console.log(`  专有名词/边缘词: ${a.basewrdTokens}`);
console.log(`  表外词: ${a.unknownTokens} token / ${a.unknownLemmas.length} 词型`);
console.log(`词表覆盖率: ${(a.coverageOfAll * 100).toFixed(1)}%`);
console.log(`低门槛(90%): ${r.low} 词`);
console.log(`建议词汇量(95%): ${r.recommended} 词`);
console.log(r.note);
if (a.surprisingWords.length) {
  console.log('高频率生词: ' + a.surprisingWords.map((w) => `${w.word}(${w.count}×${w.level}K)`).join(' '));
}
