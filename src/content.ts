import { analyzeSubtitle } from './core/analyzer.js';
import { dictionaryRegistry, DEFAULT_DICTIONARY_ID } from './core/dictionary.js';
import { lemmatizer } from './core/lemmatizer.js';
import { USER_VOCAB_KEY, WPM_KEY } from './core/settings.js';
import { naturalWpm, rateForWpm } from './core/playback.js';
import type { SubtitleTrack } from './core/types.js';
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

  /** 当前视频的自然语速缓存（word/min）；与 naturalRateVideoId 配套使用 */
  let naturalRateCache: number | null = null;
  let naturalRateVideoId: string | null = null;
  /** 当前视频的字幕轨道列表（WPM 计算需要，与面板共用一份） */
  let currentTracks: SubtitleTrack[] = [];
  /** 用户设置的目标语速(WPM)；null 表示不控制播放速度 */
  let currentTargetWpm: number | null = null;
  /** 已挂载倍速恢复监听的 video 元素 */
  let watchedVideo: HTMLVideoElement | null = null;

  const panel = new VocabPanel({
    async analyze(track, dictId) {
      const dict = dictionaryRegistry.get(dictId) ?? dictionaryRegistry.get(DEFAULT_DICTIONARY_ID)!;
      const cues = await site.fetchTrackContent(track);
      // 缓存自然语速，供 WPM 控制复用（同视频同一份字幕只抓一次）
      const vid = videoId();
      if (vid) {
        naturalRateVideoId = vid;
        naturalRateCache = naturalWpm(cues);
      }
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

  /** 主播放器 video 元素（侧边栏悬浮预览等次要 video 不匹配） */
  function currentVideoEl(): HTMLVideoElement | null {
    return (
      document.querySelector<HTMLVideoElement>('video.html5-main-video') ??
      document.querySelector<HTMLVideoElement>('video')
    );
  }

  /**
   * 换视频后播放器会重置倍速，此时重新应用目标倍速。
   * 仅在"新视频加载"时生效，不干预播放过程中的手动调速。
   */
  function onVideoLoadedMetadata(): void {
    void applyTargetWpm();
  }

  /** 给 video 挂载换视频监听；同一元素只挂一次 */
  function ensureVideoWatched(video: HTMLVideoElement): void {
    if (watchedVideo === video) return;
    watchedVideo?.removeEventListener('loadedmetadata', onVideoLoadedMetadata);
    watchedVideo = video;
    video.addEventListener('loadedmetadata', onVideoLoadedMetadata);
  }

  /** 计算当前视频的自然语速（word/min）；无法得到时返回 null */
  async function ensureNaturalRate(): Promise<number | null> {
    const vid = videoId();
    if (!vid) return null;
    if (naturalRateVideoId === vid && naturalRateCache != null) return naturalRateCache;
    const track = currentTracks.find((t) => t.lang.startsWith('en')) ?? currentTracks[0];
    if (!track) return null;
    try {
      const cues = await site.fetchTrackContent(track);
      naturalRateVideoId = vid;
      naturalRateCache = naturalWpm(cues);
      return naturalRateCache;
    } catch {
      return null;
    }
  }

  /** 按目标语速设置当前视频播放倍速；未设置目标时恢复 1x */
  async function applyTargetWpm(): Promise<void> {
    const video = currentVideoEl();
    if (!video) return;
    ensureVideoWatched(video);
    if (currentTargetWpm == null) {
      video.playbackRate = 1;
      return;
    }
    const natural = await ensureNaturalRate();
    if (natural == null) return;
    const rate = rateForWpm(currentTargetWpm, natural);
    if (rate != null) {
      console.debug(`[vve] 应用语速: ${currentTargetWpm} WPM → ${rate.toFixed(2)}x（自然语速 ${natural.toFixed(0)} WPM）`);
      video.playbackRate = rate;
    }
  }

  /** 读取并设置目标语速，然后应用到当前视频 */
  function readTargetWpm(value: unknown): void {
    currentTargetWpm = typeof value === 'number' && value > 0 ? value : null;
    void applyTargetWpm();
  }

  // 初始读取用户词汇量与目标语速，并监听 popup 修改实时生效
  void chrome.storage.local.get(USER_VOCAB_KEY).then((data) => readUserVocab(data[USER_VOCAB_KEY]));
  void chrome.storage.local.get(WPM_KEY).then((data) => readTargetWpm(data[WPM_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[USER_VOCAB_KEY]) {
      readUserVocab(changes[USER_VOCAB_KEY].newValue);
    }
    if (changes[WPM_KEY]) {
      readTargetWpm(changes[WPM_KEY].newValue);
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
      currentTracks = tracks;
      panel.setTracks(tracks);
      const auto = tracks.some((t) => t.lang.startsWith('en'));
      panel.setStatus(`共 ${tracks.length} 条字幕轨道${auto ? '，自动分析英语轨道' : ''}`);
      return auto;
    } catch (err) {
      if (mySeq !== loadSeq) return false;
      currentTracks = [];
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
      naturalRateCache = null;
      naturalRateVideoId = null;
      currentTracks = [];
      void (async () => {
        await refreshDictionaryList();
        const auto = await loadTracks();
        if (auto) await panel.run();
        await applyTargetWpm();
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
