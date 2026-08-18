import { DEFAULT_DICTIONARY_ID, dictionaryRegistry } from './core/dictionary.js';
import type { ExtensionRequest, ExtensionResponse } from './core/messages.js';
import { registerBncDictionary } from './dictionary/bnc.js';

// 注册词典（与 content script 保持同一份注册表逻辑）
registerBncDictionary();

/* ------------------------------------------------------------------ *
 * pot 字幕 URL 捕获
 * ------------------------------------------------------------------ */

const POT_URLS_KEY = 'potTimedtextUrls';
const potUrlCache = new Map<string, string>();

async function loadPotCache(): Promise<void> {
  const data = await chrome.storage.session.get(POT_URLS_KEY);
  const obj = data[POT_URLS_KEY] as Record<string, string> | undefined;
  if (obj && typeof obj === 'object') {
    potUrlCache.clear();
    for (const [k, v] of Object.entries(obj)) potUrlCache.set(k, v);
  }
}
void loadPotCache();

async function savePotCache(): Promise<void> {
  await chrome.storage.session.set({ [POT_URLS_KEY]: Object.fromEntries(potUrlCache) });
}

/**
 * 监听播放器发起的 timedtext 请求，捕获带 pot 的 URL。
 * 该 URL 由播放器以页面身份+attestation 生成，可复用改参数抓取其他轨道。
 */
function handleTimedtextRequest(details: chrome.webRequest.WebResponseCacheDetails): void {
  try {
    const u = new URL(details.url);
    if (!u.searchParams.get('pot')) return;
    const videoId = u.searchParams.get('v');
    if (!videoId) return;
    potUrlCache.set(videoId, details.url);
    void savePotCache();
    console.debug('[vve] 已捕获 pot 字幕请求:', videoId, 'lang=' + u.searchParams.get('lang'));
  } catch {
    // 忽略解析失败
  }
}

chrome.webRequest.onCompleted.addListener(handleTimedtextRequest, {
  urls: ['*://*.youtube.com/api/timedtext*'],
});

/* ------------------------------------------------------------------ *
 * 消息处理
 * ------------------------------------------------------------------ */

/**
 * 抓取 timedtext。注意：不能改动 URL 参数——签名覆盖 sparams 列出的参数，
 * 改动会返回空内容。这里仅兜底补 fmt=json3。
 */
async function fetchSubtitleText(url: string): Promise<{ status: number; text: string }> {
  const finalUrl = url.includes('&fmt=') || url.includes('?fmt=') ? url : `${url}${url.includes('?') ? '&' : '?'}fmt=json3`;
  const res = await fetch(finalUrl);
  return { status: res.status, text: await res.text() };
}

async function handleMessage(
  msg: ExtensionRequest,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionResponse> {
  switch (msg.type) {
    case 'GET_STATE': {
      const stored = await chrome.storage.local.get(dictionaryRegistry.storageKey);
      const activeId = (stored[dictionaryRegistry.storageKey] as string | undefined) ?? DEFAULT_DICTIONARY_ID;
      return { type: 'STATE', dictionaries: dictionaryRegistry.list(), activeId };
    }
    case 'SET_ACTIVE_DICTIONARY': {
      await chrome.storage.local.set({ [dictionaryRegistry.storageKey]: msg.id });
      return { type: 'SET_OK', id: msg.id };
    }
    case 'FETCH_SUBTITLE': {
      try {
        const { status, text } = await fetchSubtitleText(msg.url);
        return { type: 'FETCH_SUBTITLE_RESULT', status, text };
      } catch (err) {
        return { type: 'ERROR', message: `字幕请求失败: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    case 'GET_POT_URL': {
      const url = potUrlCache.get(msg.videoId) ?? null;
      return { type: 'POT_URL_RESULT', url };
    }
    case 'SET_PLAYBACK_RATE': {
      if (!sender.tab?.id) {
        return { type: 'ERROR', message: '未找到标签页' };
      }
      try {
        // 在页面主世界调用播放器 API，复用 YouTube 自带的时间伸缩算法，保证变速音质
        await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          world: 'MAIN',
          func: (rate: number) => {
            const player = document.getElementById('movie_player') as unknown as {
              setPlaybackRate?: (r: number) => void;
            };
            if (player && typeof player.setPlaybackRate === 'function') {
              player.setPlaybackRate(rate);
            }
          },
          args: [msg.rate],
        });
        return { type: 'RATE_SET' };
      } catch (err) {
        return { type: 'ERROR', message: `设置播放速度失败: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    default:
      return { type: 'ERROR', message: '未知消息类型' };
  }
}

chrome.runtime.onMessage.addListener((msg: ExtensionRequest, sender, sendResponse) => {
  void handleMessage(msg, sender).then(sendResponse);
  return true; // 异步响应
});
