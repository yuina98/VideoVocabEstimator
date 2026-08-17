// 从 Range 程序的 basewrd31.txt（官方 BNC/COCA proper names 词表）生成 proper-nouns.ts。
// 用法: npm run gen:proper-nouns -- <path-to-basewrd31.txt>
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) {
  console.error('用法: npm run gen:proper-nouns -- <basewrd31.txt>');
  process.exit(1);
}

const lines = readFileSync(input, 'utf8').split(/\r?\n/);
const words = new Set();
for (const line of lines) {
  // 词头无缩进、词族成员以 \t 缩进；取第一个字段
  const tok = line.replace(/^\t/, '').split(/\s+/)[0].toLowerCase();
  // 仅纯字母且长度>=2，与分词器([a-z]+)对齐，过滤编号/单字符等
  if (!tok || !/^[a-z]{2,}$/.test(tok)) continue;
  words.add(tok);
}
const sorted = [...words].sort();

const linesOut = [];
linesOut.push('// 由官方 BNC/COCA proper names 词表（Range 程序 basewrd31.txt）生成，勿手改。');
linesOut.push('// 数据源: https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/vocabulary-analysis-programs');
linesOut.push('// 已按分词器对齐过滤：仅纯字母、长度>=2。专有名词视为 level 1 已知。');
linesOut.push('export const PROPER_NOUNS: string[] = [');
for (const w of sorted) linesOut.push(`  '${w}',`);
linesOut.push('];');
writeFileSync('src/dictionary/proper-nouns.ts', linesOut.join('\n') + '\n');
console.log(`生成完成: ${sorted.length} 个专有名词 -> src/dictionary/proper-nouns.ts`);
