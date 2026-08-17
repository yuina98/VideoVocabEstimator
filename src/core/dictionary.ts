import type { DictionaryMeta, WordFrequencyEntry } from './types.js';

/**
 * 词典接口 —— 中间层抽象。
 *
 * 未来接入新词典(如 COCA、NGSL 或自定义分级表)时，只需实现该接口
 * 并调用 `registerDictionary()` 注册，即可被分析器与设置界面使用。
 */
export interface Dictionary {
  readonly meta: DictionaryMeta;
  /** 查询一个词元的词频信息；查不到返回 null */
  lookup(word: string): WordFrequencyEntry | null;
}

class DictionaryRegistryImpl {
  private readonly dicts = new Map<string, Dictionary>();

  register(dict: Dictionary): void {
    if (this.dicts.has(dict.meta.id)) {
      throw new Error(`词典已注册: ${dict.meta.id}`);
    }
    this.dicts.set(dict.meta.id, dict);
  }

  get(id: string): Dictionary | null {
    return this.dicts.get(id) ?? null;
  }

  list(): DictionaryMeta[] {
    return [...this.dicts.values()].map((d) => d.meta);
  }

  /** 当前启用词典的存储键 */
  readonly storageKey = 'activeDictionary';
}

/** 全局词典注册表单例 */
export const dictionaryRegistry = new DictionaryRegistryImpl();

/** 默认词典 id(BNC) */
export const DEFAULT_DICTIONARY_ID = 'bnc';
