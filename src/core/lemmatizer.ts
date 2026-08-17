import nlp from 'compromise';

/**
 * 词形还原器接口。
 *
 * 返回单词所有可能的词元候选（分别按动词/名词词性还原），
 * 由上层逐一与词典比对，避免缺少词性标注时错失命中。
 */
export interface Lemmatizer {
  /** 返回候选词元，如 running -> [run]、children -> [child] */
  lemmatize(word: string): string[];
}

/** 词形还原库未覆盖的零星虚词（an -> a） */
const EXCEPTIONS: Record<string, string> = {
  an: 'a',
};

/** 基于 compromise（成熟浏览器 NLP 库）的实现 */
class CompromiseLemmatizer implements Lemmatizer {
  lemmatize(word: string): string[] {
    const w = word.toLowerCase();
    const out = new Set<string>();

    const exception = EXCEPTIONS[w];
    if (exception) out.add(exception);

    // 词根提取依赖正确词性，分别按动词/名词强制标注后还原
    for (const tag of ['#Verb', '#Noun'] as const) {
      try {
        // tag() 在类型上是基础 View，运行时仍是完整 View，做安全断言
        const doc = nlp(w).tag(tag) as ReturnType<typeof nlp>;
        const lemma =
          tag === '#Verb' ? doc.verbs().toInfinitive().out('text') : doc.nouns().toSingular().out('text');
        if (lemma && lemma !== w) out.add(lemma);
      } catch {
        // 忽略单个词性还原失败
      }
    }

    // -ly 副词还原为形容词原形（quickly -> quick、happily -> happy）
    if (w.length > 4 && w.endsWith('ly')) {
      out.add(w.endsWith('ily') ? `${w.slice(0, -3)}y` : w.slice(0, -2));
    }

    return [...out];
  }
}

/** 全局词形还原器 */
export const lemmatizer: Lemmatizer = new CompromiseLemmatizer();

/** 展开缩略形式（I'm -> I am），供分词前调用 */
export function expandContractions(text: string): string {
  const doc = nlp(text);
  doc.contractions().expand();
  return doc.out('text');
}
