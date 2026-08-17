import { analyzeSubtitle } from './core/analyzer.js';
import { dictionaryRegistry, DEFAULT_DICTIONARY_ID } from './core/dictionary.js';
import { lemmatizer } from './core/lemmatizer.js';
import { USER_VOCAB_KEY } from './core/settings.js';
import { siteAdapterRegistry } from './adapters/registry.js';
import { registerYoutubeAdapter } from './adapters/youtube.js';
import { registerBncDictionary } from './dictionary/bnc.js';
import { VocabPanel } from './ui/panel.js';

function main(): void {
  // 注册站点适配器与词典（基础设施，未来扩展在此追加）
  registerYoutubeAdapter();
  registerBncDictionary();

  const adapter = siteAdapterRegistry.resolve(new URL(location.href));
  if (!adapter) return; // 非支持网站，静默退出
  const site = adapter;

  const panel = new VocabPanel({
    async analyze(track, dictId) {
      const dict = dictionaryRegistry.get(dictId) ?? dictionaryRegistry.get(DEFAULT_DICTIONARY_ID)!;
      const cues = await site.fetchTrackContent(track);
      const text = cues.map((c) => c.text).join(' ');
      return analyzeSubtitle(text, dict, lemmatizer);
    },
  });

  /** 当前观看页视频 id；非观看页返回 null */
  function videoId(): string | null {
    if (!location.pathname.startsWith('/watch')) return null;
    return new URLSearchParams(location.search).get('v');
  }

  /** 读取并设置用户词汇量（词），无效则清除标记 */
  function readUserVocab(value: unknown): void {
    panel.setUserVocab(typeof value === 'number' && value > 0 ? value : null);
  }

  // 初始读取用户词汇量，并监听 popup 修改实时更新曲线标记
  void chrome.storage.local.get(USER_VOCAB_KEY).then((data) => readUserVocab(data[USER_VOCAB_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[USER_VOCAB_KEY]) {
      readUserVocab(changes[USER_VOCAB_KEY].newValue);
    }
  });

  /** YouTube 观看页右侧推荐栏容器 */
  function sidebar(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#secondary') ??
      document.querySelector<HTMLElement>('#secondary-inner') ??
      document.querySelector<HTMLElement>('ytd-watch-next-secondary-results-renderer')
    );
  }

  async function refreshDictionaryList(): Promise<void> {
    const metas = dictionaryRegistry.list();
    const activeId = (await chrome.storage.local.get(dictionaryRegistry.storageKey))[
      dictionaryRegistry.storageKey
    ] as string | undefined;
    panel.setDictionaries(metas, activeId ?? DEFAULT_DICTIONARY_ID);
  }

  let loadSeq = 0;
  /** 加载轨道列表；存在英语轨道时返回 true（供自动分析） */
  async function loadTracks(): Promise<boolean> {
    const mySeq = ++loadSeq;
    panel.setBusy(true);
    panel.reset();
    try {
      panel.setStatus('正在读取字幕…');
      const tracks = await site.listTracks();
      if (mySeq !== loadSeq) return false; // 已切换到更新的视频，丢弃过期结果
      panel.setTracks(tracks);
      const auto = tracks.some((t) => t.lang.startsWith('en'));
      panel.setStatus(`共 ${tracks.length} 条字幕轨道${auto ? '，自动分析英语轨道' : ''}`);
      return auto;
    } catch (err) {
      if (mySeq !== loadSeq) return false;
      panel.setTracks([]);
      panel.showError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      if (mySeq === loadSeq) panel.setBusy(false);
    }
  }

  let currentVideoId: string | null = null;

  /** 挂载/卸载面板，并检测 SPA 换视频 */
  function handle(): void {
    const sb = sidebar();
    if (!sb) {
      if (panel.isMounted()) panel.unmount();
      currentVideoId = null;
      return;
    }
    if (!panel.isMounted()) panel.mount(sb);

    const vid = videoId();
    if (vid && vid !== currentVideoId) {
      currentVideoId = vid;
      void (async () => {
        await refreshDictionaryList();
        const auto = await loadTracks();
        if (auto) void panel.run(); // 有英文字幕则自动分析
      })();
    }
  }

  new MutationObserver(handle).observe(document.documentElement, { childList: true, subtree: true });
  handle();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}
