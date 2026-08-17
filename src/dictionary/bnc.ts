import { dictionaryRegistry, type Dictionary } from '../core/dictionary.js';
import type { WordFrequencyEntry } from '../core/types.js';
import { BNC_FAMILIES } from './bnc.data.js';
import { PROPER_NOUNS } from './proper-nouns.js';
import { MARGINAL_WORDS } from './marginal-words.js';
import { ACRONYMS } from './acronyms.js';

const WORDS_PER_LEVEL = 1000;

/**
 * BNC/COCA 前 10000 词族词典（含词族成员）。
 *
 * 词表按词族组织，成员（如 recovery、your、running）映射到其词头
 * （recover、you、run）所在的分级。查询表按需惰性构建。
 */
class BncDictionary implements Dictionary {
  readonly meta = {
    id: 'bnc',
    name: 'BNC/COCA 25k（词族 + 专有名词）',
    description: 'BNC/COCA 前 25000 词族（含成员）+ 官方 proper names/缩写/边缘词，按千词分级（Paul Nation）。',
  } as const;

  private table: Map<string, WordFrequencyEntry> | null = null;

  private ensureTable(): Map<string, WordFrequencyEntry> {
    if (this.table) return this.table;

    const table = new Map<string, WordFrequencyEntry>();
    BNC_FAMILIES.forEach((levelFamilies, i) => {
      const levelNo = i + 1;
      levelFamilies.forEach((family, j) => {
        const headword = family[0];
        const rank = (levelNo - 1) * WORDS_PER_LEVEL + j + 1;
        // 词族内所有成员共享词头的分级；重复词取首次出现
        for (const w of family) {
          if (!table.has(w)) {
            table.set(w, { word: headword, rank, level: levelNo });
          }
        }
      });
    });

    // 官方分类词表（专有名词/边缘词/缩写）单开一类：level 0，不并入分级。
    // level 1..25 为分级词表；0 表示"已知但非分级"（专有名词/边缘词/缩写）。
    const level0Lists = [PROPER_NOUNS, MARGINAL_WORDS, ACRONYMS];
    for (const list of level0Lists) {
      for (const w of list) {
        if (!table.has(w)) {
          table.set(w, { word: w, rank: 0, level: 0 });
        }
      }
    }

    this.table = table;
    return table;
  }

  lookup(word: string): WordFrequencyEntry | null {
    const w = word.toLowerCase();
    const table = this.ensureTable();
    const hit = table.get(w);
    if (hit) return hit;
    return this.decomposeCompound(table, w);
  }

  /**
   * 透明复合词拆解：gunboat -> gun + boat。
   * 各成分取词族表分级，整体按成分的最高分级计（需认识所有成分）。
   * 拆分成两段、每段至少 3 字母，取分级最低的可行切分。
   */
  private decomposeCompound(table: Map<string, WordFrequencyEntry>, w: string): WordFrequencyEntry | null {
    if (w.length < 6) return null;
    let best: WordFrequencyEntry | null = null;
    for (let i = 3; i <= w.length - 3; i++) {
      const a = table.get(w.slice(0, i));
      const b = table.get(w.slice(i));
      if (a && b) {
        const level = Math.max(a.level, b.level);
        // rank 取成分中较高者，避免 rank=0 破坏意外度(Zipf)计算
        const rank = Math.max(a.rank, b.rank);
        if (!best || level < best.level) {
          best = { word: w, rank, level };
        }
      }
    }
    return best;
  }
}

/** 注册 BNC 词典 */
export function registerBncDictionary(): void {
  dictionaryRegistry.register(new BncDictionary());
}
