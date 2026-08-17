/** 一条字幕 cue(时间戳 + 文本) */
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/** 一个字幕轨道 */
export interface SubtitleTrack {
  /** 语言代码，如 en、zh-Hans */
  lang: string;
  /** 展示名，如 English、自动生成的字幕 */
  label: string;
  /** 是否自动生成 */
  auto?: boolean;
  /** 适配器内部使用的抓取地址（可选，如 timedtext baseUrl） */
  sourceUrl?: string;
  /** 字幕内容（listTracks 阶段为空，fetchTrackContent 后填充） */
  cues: SubtitleCue[];
}

/** 词典中一个词条的词频信息 */
export interface WordFrequencyEntry {
  /** 词元(lemma)，如 run */
  word: string;
  /** 全局词频排名，1 为最高频 */
  rank: number;
  /** 所在词频分级，1 表示最常用的一千词，2 表示第二千词，依此类推 */
  level: number;
}

/** 词汇量估算结果 */
export interface VocabAnalysis {
  /** 字幕总词数(token 数) */
  totalTokens: number;
  /** 去词形后的唯一词元数 */
  uniqueLemmas: number;
  /** 专有名词/边缘词/缩写等非分级词(token 数)，不计入分级覆盖率 */
  basewrdTokens: number;
  /** 词典中查不到的词元 token 数（表外词，不参与覆盖率比例） */
  unknownTokens: number;
  /** 词典中查不到的词元（去重），每个词型计入建议词汇量 */
  unknownLemmas: string[];
  /** 按 rank 升序的累计覆盖率：rank 为词表名次(词)，cumulative 为 rank≤该值的分级词累计占比(0~1) */
  coverageByRank: Array<{ rank: number; cumulative: number }>;
  /** 词表对全视频的覆盖率：分级词累计 token 数 / 总 token 数(含 basewrd 与表外词) */
  coverageOfAll: number;
  /** 生词清单：视频中出现频率远高于词表(rank)预期的词，按“意外度”降序 */
  surprisingWords: Array<{ word: string; count: number; level: number }>;
  /** 词汇量估算区间与建议值 */
  requiredVocab: {
    /** 覆盖 90% 词所需词汇量下限 */
    low: number;
    /** 覆盖 95% 词所需词汇量建议值 */
    recommended: number;
    /** 提示文案 */
    note: string;
  };
}

/** 词典元数据(与数据本体分离，便于列表展示) */
export interface DictionaryMeta {
  id: string;
  name: string;
  description: string;
}
