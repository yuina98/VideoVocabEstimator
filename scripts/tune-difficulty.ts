/**
 * 调参工具：对比不同难度指数 exp 下的"高频生词"排序。
 *
 * 用法：把字幕文本存成文件，然后 npm run tune -- <字幕文件路径>
 *
 * 输出每个指数下的 Top10（词 + 次数 + 分级），人工判断哪个排序
 * 最适合语言学习（该学的难词靠前、简单常见词靠后）。
 */
import { readFileSync } from 'node:fs';
import { analyzeSubtitle, type AnalyzeOptions } from '../src/core/analyzer.js';
import { dictionaryRegistry } from '../src/core/dictionary.js';
import { registerBncDictionary } from '../src/dictionary/bnc.js';
import { lemmatizer } from '../src/core/lemmatizer.js';

registerBncDictionary();
const dict = dictionaryRegistry.get('bnc');

const path = process.argv[2];
if (!path) {
  console.error('用法: npm run tune -- <字幕文件路径>');
  process.exit(1);
}
const text = readFileSync(path, 'utf8');

const exponents: Array<{ exp: number; note: string }> = [
  { exp: 1, note: '意外度×level(不放大难度)' },
  { exp: 1.5, note: '轻度放大' },
  { exp: 2, note: '中等放大' },
  { exp: 2.5, note: '较强放大' },
  { exp: 3, note: '强放大' },
];

for (const { exp, note } of exponents) {
  const opts: AnalyzeOptions = { difficultyExponent: exp };
  const a = analyzeSubtitle(text, dict, lemmatizer, opts);
  const list = a.surprisingWords.map((w) => `${w.word}(${w.count}×${w.level}K)`).join('  ');
  console.log(`\nexp=${exp}  ${note}\n  ${list || '(无)'}`);
}
