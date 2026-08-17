import type { Dictionary } from './dictionary.js';
import { expandContractions, type Lemmatizer } from './lemmatizer.js';
import type { VocabAnalysis, WordFrequencyEntry } from './types.js';

/** 覆盖率达到该值时视为"低门槛"所需词汇量 */
const LOW_COVERAGE = 0.9;
/** 覆盖率达到该值时给出建议词汇量 */
const RECOMMENDED_COVERAGE = 0.95;
/** 每个词频分级包含的词数(BNC 按千词分级) */
const WORDS_PER_LEVEL = 1000;
/** 生词清单难度加权指数：score = 意外度 × level^exp */
const DIFFICULTY_EXPONENT = 2;

/** 分析选项 */
export interface AnalyzeOptions {
  /** 难度加权指数（默认 2），用于生词清单排序 */
  difficultyExponent?: number;
}

/** 从字幕文本中提取单词 token(小写)；先展开缩略形式(I'm -> i am)，再剥离所有格 's */
export function tokenize(text: string): string[] {
  const normalized = expandContractions(text.toLowerCase()).replace(/'s\b/g, '');
  const matches = normalized.match(/[a-z]+(?:'[a-z]+)?/g);
  return matches ?? [];
}

/**
 * 分析一段字幕文本，估算理解它所需的词汇量。
 *
 * 流程：分词 → 词形还原 → 查词频词典 → 计算各分级的累计覆盖率 → 估算词汇量。
 */
export function analyzeSubtitle(
  text: string,
  dict: Dictionary,
  lem: Lemmatizer,
  opts: AnalyzeOptions = {},
): VocabAnalysis {
  const tokens = tokenize(text);
  const totalTokens = tokens.length;

  // 词元 -> 计数与命中词典条目
  // 查找顺序：先查原形（词头表可能直接收录 only/according 等），
  // 再逐一尝试各词性的候选词元（running -> run）
  const freq = new Map<string, { count: number; entry: WordFrequencyEntry | null }>();
  for (const t of tokens) {
    let entry = dict.lookup(t);
    let lemma = t;
    if (!entry) {
      for (const candidate of lem.lemmatize(t)) {
        entry = dict.lookup(candidate);
        if (entry) {
          lemma = candidate;
          break;
        }
      }
    }
    const record = freq.get(lemma);
    if (record) {
      record.count++;
    } else {
      freq.set(lemma, { count: 1, entry });
    }
  }

  // 归类：分级词(level 1..25)、非分级词(basewrd，level 0)、表外词(查不到)。
  // 表外词不参与覆盖率比例，但每个表外词型都计入所需词汇量；basewrd 单开一类。
  let gradedTokens = 0;
  let basewrdTokens = 0;
  let unknownTokens = 0;
  const unknownLemmas: string[] = [];
  const levelOf = new Map<string, number>();
  for (const [lemma, { count, entry }] of freq) {
    if (entry && entry.level >= 1) {
      gradedTokens += count;
      levelOf.set(lemma, entry.level);
    } else if (entry) {
      basewrdTokens += count;
    } else {
      unknownTokens += count;
      unknownLemmas.push(lemma);
    }
  }

  const maxLevel = Math.max(0, ...levelOf.values());
  const uniqueLemmas = freq.size;

  // 词表对全视频的覆盖率：分母为全部 token(含 basewrd 与表外词)
  const coverageOfAll = totalTokens > 0 ? gradedTokens / totalTokens : 0;

  // 按 rank 升序排列的分级词(token 数)，供精确估算与曲线采样用
  const byRank: Array<{ rank: number; count: number }> = [];
  for (const { count, entry } of freq.values()) {
    if (entry && entry.level >= 1) {
      byRank.push({ rank: Math.max(1, entry.rank), count });
    }
  }
  byRank.sort((a, b) => a.rank - b.rank);

  // 按 rank 累计的覆盖率曲线数据：每个出现过的 rank 一个点，精确到词。
  // 分母仅为分级词总量；相同 rank 合并为一个点。
  const total = Math.max(1, gradedTokens);
  const coverageByRank: Array<{ rank: number; cumulative: number }> = [];
  let acc = 0;
  for (const { rank, count } of byRank) {
    acc += count;
    const last = coverageByRank[coverageByRank.length - 1];
    if (last && last.rank === rank) {
      last.cumulative = acc / total;
    } else {
      coverageByRank.push({ rank, cumulative: acc / total });
    }
  }

  // 词汇量估算：按 rank 精确累计，找出覆盖率达到阈值的词数，
  // 再叠加表外词型数——每个表外词都需要额外认识。
  const requiredVocab = estimateVocab(byRank, gradedTokens, maxLevel, unknownLemmas.length);

  // 生词清单：视频中实际出现次数远高于词表 rank 所预测的词。
  // Zipf 模型下每个词元预期 token 数 ∝ 1/rank，按观测总量标定比例常数。
  // 难度项为相对基准：difficulty = rank / 建议词汇量——即该词排在词表
  // 第 rank 位，相对"已知约 recommended 词"高出的倍数，无需换算成分级。
  // 排序分 = 意外度 × difficulty^exp。
  // 过滤：出现 ≥3 次，且 level ≥2（1K 边界）——最常用的一千词族不列入
  // 生词清单，纯公式压不住 you/the 这类被高频使用的词。
  let sumInvRank = 0;
  const ranked: Array<{ lemma: string; count: number; rank: number; level: number }> = [];
  for (const [lemma, { count, entry }] of freq) {
    if (entry && entry.level >= 1) {
      sumInvRank += 1 / Math.max(1, entry.rank);
      ranked.push({ lemma, count, rank: Math.max(1, entry.rank), level: entry.level });
    }
  }
  const scale = sumInvRank > 0 ? gradedTokens / sumInvRank : 0;
  const exp = opts.difficultyExponent ?? DIFFICULTY_EXPONENT;
  const baseline = Math.max(1, requiredVocab.recommended);
  const surprisingWords = ranked
    .map((w) => ({
      word: w.lemma,
      count: w.count,
      level: w.level,
      score: (w.count / (scale / w.rank)) * Math.pow(w.rank / baseline, exp),
    }))
    .filter((w) => w.count >= 3 && w.level >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ word, count, level }) => ({ word, count, level }));

  return {
    totalTokens,
    uniqueLemmas,
    basewrdTokens,
    unknownTokens,
    unknownLemmas,
    coverageByRank,
    coverageOfAll,
    surprisingWords,
    requiredVocab,
  };
}

function estimateVocab(
  byRank: Array<{ rank: number; count: number }>,
  gradedTokens: number,
  maxLevel: number,
  extraWords: number,
): VocabAnalysis['requiredVocab'] {
  const low = rankAtCoverage(byRank, gradedTokens, LOW_COVERAGE);
  const recommended = rankAtCoverage(byRank, gradedTokens, RECOMMENDED_COVERAGE);

  if (recommended == null) {
    // 即使覆盖到词表末尾仍达不到 95%
    return {
      low: (low ?? maxLevel * WORDS_PER_LEVEL) + extraWords,
      recommended: maxLevel * WORDS_PER_LEVEL + extraWords,
      note: '即使达到词表最高分级仍低于 95% 覆盖率，可能存在大量词表外的专业词汇。',
    };
  }

  return {
    low: (low ?? recommended) + extraWords,
    recommended: recommended + extraWords,
    note: '按 95% 覆盖率估算建议词汇量。',
  };
}

/**
 * 求达到指定覆盖率所需的最小 rank。
 *
 * 按 rank 升序累计 token 数，首次越过 threshold×gradedTokens 的 rank，
 * 即"认识前 rank 个词族即可覆盖该比例"。精确到词，无需级内插值假设。
 */
function rankAtCoverage(
  byRank: Array<{ rank: number; count: number }>,
  gradedTokens: number,
  threshold: number,
): number | null {
  const target = threshold * gradedTokens;
  let acc = 0;
  for (const { rank, count } of byRank) {
    acc += count;
    if (acc >= target) return rank;
  }
  return null;
}
