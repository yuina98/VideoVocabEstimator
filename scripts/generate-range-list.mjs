// 从 Range 程序的 basewrd*.txt 生成分类词表 TS 文件。
// 用法: npm run gen:range-list -- <basewrd.txt> <输出路径> <导出名> "<文件头注释>" [minLen=2]
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output, exportName, header, minLenArg] = process.argv.slice(2);
const minLen = Number(minLenArg ?? 2);
if (!input || !output || !exportName) {
  console.error('用法: npm run gen:range-list -- <basewrd.txt> <输出路径> <导出名> "<注释>" [minLen]');
  process.exit(1);
}

const lines = readFileSync(input, 'utf8').split(/\r?\n/);
const words = new Set();
for (const line of lines) {
  const tok = line.replace(/^\t/, '').split(/\s+/)[0].toLowerCase();
  if (!tok) continue;
  const re = minLen <= 1 ? /^[a-z]+$/ : /^[a-z]{2,}$/;
  if (!re.test(tok)) continue;
  words.add(tok);
}
const sorted = [...words].sort();

const out = [];
out.push('// 由官方 BNC/COCA 分类词表（Range 程序）生成，勿手改。');
out.push('// 数据源: https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/vocabulary-analysis-programs');
out.push(`// ${header ?? ''}`);
out.push(`export const ${exportName}: string[] = [`);
for (const w of sorted) out.push(`  '${w}',`);
out.push('];');
writeFileSync(output, out.join('\n') + '\n');
console.log(`生成完成: ${sorted.length} 词 -> ${output}`);
