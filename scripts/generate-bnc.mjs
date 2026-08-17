// 从 EAP Foundation BNC/COCA v2 词族表(xlsx)生成 bnc.data.ts（前 N 千词族，含成员）。
// 用法: npm run gen:bnc -- <path-to-xlsx> [maxLevel=10]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const xlsxPath = process.argv[2];
const maxLevel = Number(process.argv[3] ?? 10);
if (!xlsxPath) {
  console.error('用法: npm run gen:bnc -- <xlsx> [maxLevel]');
  process.exit(1);
}

// 用 python 标准库解析 xlsx -> JSON（避免引入 xlsx npm 依赖）
const py = String.raw`
import zipfile, re, json, sys, xml.etree.ElementTree as ET
z = zipfile.ZipFile(sys.argv[1])
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
shared = []
root = ET.fromstring(z.read('xl/sharedStrings.xml'))
for si in root.findall('m:si', ns):
    txt = ''.join(t.text or '' for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t'))
    shared.append(txt)
root = ET.fromstring(z.read('xl/worksheets/sheet1.xml').decode('utf-8'))
out = []
for r in root.findall('.//m:row', ns)[1:]:
    cells = {}
    for c in r.findall('m:c', ns):
        ref = c.get('r'); typ = c.get('t'); v = c.find('m:v', ns)
        col = re.match(r'([A-Z]+)', ref).group(1)
        if v is None: val = ''
        else:
            val = v.text or ''
            if typ == 's': val = shared[int(val)]
        cells[col] = val
    lvl_s = cells.get('A', ''); hw = cells.get('B', '').strip()
    if not hw:
        continue
    m = re.match(r'(\d+)k', lvl_s)
    if not m:
        continue
    lvl = int(m.group(1))
    if lvl > int(sys.argv[2]):
        continue
    members = []
    for part in cells.get('C', '').split(', '):
        w = part.split(' (')[0].strip().lower()
        if w:
            members.append(w)
    out.append({'level': lvl, 'headword': hw.lower(), 'members': members})
json.dump(out, open(sys.argv[3], 'w'))
`;

const tmpJson = join(tmpdir(), `vve-families-${Date.now()}.json`);
const tmpPy = join(mkdtempSync(join(tmpdir(), 'vve-')), 'parse.py');
writeFileSync(tmpPy, py);
execFileSync('python3', [tmpPy, xlsxPath, String(maxLevel), tmpJson], { stdio: 'inherit' });
const families = JSON.parse(readFileSync(tmpJson, 'utf8'));

// 按级别分组；词头不在成员中时用首成员补齐（数字 1/0 等异常行）
const byLevel = new Map();
for (const f of families) {
  const fam = new Set(f.members.filter(Boolean));
  let head = f.headword;
  if (!fam.has(head)) head = f.members[0] ?? '';
  if (!head) continue;
  fam.delete(head);
  const list = [head, ...fam];
  if (!byLevel.has(f.level)) byLevel.set(f.level, []);
  byLevel.get(f.level).push(list);
}

const max = Math.max(...byLevel.keys());
const lines = [];
lines.push('// 由 EAP Foundation BNC/COCA v2 词族表生成（前 ' + (max * 1000) + ' 词族，含词族成员）');
lines.push('// 数据源: https://www.eapfoundation.com/vocab/general/bnccoca/ （同源 Paul Nation BNC/COCA 25k）');
lines.push('// 结构: BNC_FAMILIES[level-1] = 该千词级的所有词族；每个词族 = [词头, 成员1, 成员2, ...]（均小写）');
lines.push('export const BNC_FAMILIES: string[][][] = [');
for (let lvl = 1; lvl <= max; lvl++) {
  const fams = byLevel.get(lvl) ?? [];
  lines.push(`  [ // level ${lvl}`);
  for (const fam of fams) {
    lines.push('    [' + fam.map((w) => JSON.stringify(w)).join(', ') + '],');
  }
  lines.push('  ],');
}
lines.push('];');
writeFileSync('src/dictionary/bnc.data.ts', lines.join('\n') + '\n');
console.log(`生成完成: levels=1..${max}, families=${families.length}, file=${'src/dictionary/bnc.data.ts'}`);
