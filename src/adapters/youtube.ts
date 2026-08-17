import type { SubtitleCue, SubtitleTrack } from '../core/types.js';
import type { ExtensionRequest, ExtensionResponse } from '../core/messages.js';
import { siteAdapterRegistry } from './registry.js';
import type { SiteAdapter } from './types.js';

/** YouTube playerResponse 中字幕轨道的结构(仅取所需字段) */
interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
}

/** timedtext JSON3 响应结构 */
interface TimedTextJson {
  events?: Array<{
    tStartMs: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
}

/* ------------------------------------------------------------------ *
 * 页面数据读取（CSP 安全：只读 <script> 文本，不执行脚本）
 * ------------------------------------------------------------------ */

/**
 * 从脚本文本中提取赋值给 key 的 JSON 对象（平衡括号扫描）。
 * content script 运行在隔离世界，无法直接读取页面 JS 全局变量，
 * 注入内联脚本又会被页面 CSP 拦截，因此解析 <script> 标签文本。
 */
function extractJsonObject<T>(text: string, key: string): T | null {
  let pos = text.indexOf(key);
  while (pos !== -1) {
    const eq = text.indexOf('=', pos);
    if (eq === -1) break;
    const brace = text.indexOf('{', eq);
    if (brace === -1) break;

    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = brace; i < text.length; i++) {
      const ch = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = !inStr;
      if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.slice(brace, i + 1)) as T;
            } catch {
              return null;
            }
          }
        }
      }
    }
    pos = text.indexOf(key, pos + 1);
  }
  return null;
}

function readPlayerResponse(): PlayerResponse | null {
  const w = window as unknown as { ytInitialPlayerResponse?: PlayerResponse };
  if (w.ytInitialPlayerResponse) return w.ytInitialPlayerResponse;
  const scripts = document.querySelectorAll('script');
  for (const s of Array.from(scripts)) {
    const text = s.textContent ?? '';
    const pr =
      extractJsonObject<PlayerResponse>(text, 'ytInitialPlayerResponse') ??
      extractJsonObject<PlayerResponse>(text, 'window["ytInitialPlayerResponse"]');
    if (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) return pr;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * timedtext 抓取
 * ------------------------------------------------------------------ */

/**
 * 抓取 timedtext 字幕文本。优先 content script 直连（pot 对页面身份签发，
 * 直连最可靠）；失败则回退 background（有 host 权限）。
 */
async function fetchTimedText(baseUrl: string): Promise<string> {
  try {
    const direct = await fetch(baseUrl);
    const text = await direct.text();
    if (direct.ok && text.length > 0) return text;
  } catch {
    // 继续走后台通道
  }

  const res = (await chrome.runtime.sendMessage({
    type: 'FETCH_SUBTITLE',
    url: baseUrl,
  } satisfies ExtensionRequest)) as ExtensionResponse;

  if (res.type === 'ERROR') throw new Error(res.message);
  if (res.type !== 'FETCH_SUBTITLE_RESULT') throw new Error('未知响应');
  if (res.status !== 200 || res.text.length === 0) {
    throw new Error(`字幕请求返回空内容 (HTTP ${res.status})`);
  }
  return res.text;
}

function parseTimedText(text: string): SubtitleCue[] {
  const json = JSON.parse(text) as TimedTextJson;
  const cues: SubtitleCue[] = [];
  const events = json.events ?? [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.segs == null) continue;
    const t = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .trim();
    if (!t) continue;
    const end = ev.dDurationMs != null ? ev.tStartMs + ev.dDurationMs : events[i + 1]?.tStartMs ?? ev.tStartMs + 1000;
    cues.push({ start: ev.tStartMs / 1000, end: end / 1000, text: t });
  }
  return cues;
}

/* ------------------------------------------------------------------ *
 * pot 复用（参考 kiss-translator：复用播放器自带 pot 的 timedtext URL）
 * ------------------------------------------------------------------ */

function queryPotUrl(videoId: string): Promise<string | null> {
  return chrome.runtime
    .sendMessage({ type: 'GET_POT_URL', videoId } satisfies ExtensionRequest)
    .then((res) => (res as ExtensionResponse).type === 'POT_URL_RESULT' ? (res as { url: string | null }).url : null);
}

/** 轮询等待后台捕获到该视频的 pot 字幕 URL */
async function waitForPotUrl(videoId: string, timeoutMs = 10000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await queryPotUrl(videoId);
    if (url) return url;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

/** 开启播放器字幕(CC)，触发播放器发起带 pot 的 timedtext 请求 */
function ensureCaptionsEnabled(): void {
  try {
    const btn = document.querySelector<HTMLElement>('button.ytp-subtitles-button');
    if (btn && btn.getAttribute('aria-pressed') === 'false') btn.click();
  } catch {
    // 忽略
  }
}

/**
 * 复用捕获到的 pot URL，改参数抓取指定轨道。
 * 与 kiss-translator 一致：改 lang/kind/fmt，保留 pot 及其他签名参数。
 */
function buildPotFetchUrl(potBaseUrl: string, track: SubtitleTrack): string {
  const u = new URL(potBaseUrl);
  u.searchParams.delete('tlang');
  u.searchParams.delete('name');
  u.searchParams.set('lang', track.lang);
  u.searchParams.set('fmt', 'json3');
  if (track.auto) u.searchParams.set('kind', 'asr');
  else u.searchParams.delete('kind');
  return u.toString();
}

/** 用捕获的 pot URL 抓取指定轨道；失败返回 null */
async function fetchViaPotUrl(potBaseUrl: string, track: SubtitleTrack): Promise<SubtitleCue[] | null> {
  try {
    const text = await fetchTimedText(buildPotFetchUrl(potBaseUrl, track));
    const cues = parseTimedText(text);
    return cues.length > 0 ? cues : null;
  } catch (err) {
    console.warn('[vve] pot URL 抓取失败:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 适配器
 * ------------------------------------------------------------------ */

function trackLabel(t: CaptionTrack): string {
  if (t.name?.simpleText) return t.name.simpleText;
  if (t.name?.runs) {
    const text = t.name.runs.map((r) => r.text ?? '').join('');
    if (text) return text;
  }
  return t.languageCode;
}

class YoutubeAdapter implements SiteAdapter {
  readonly id = 'youtube';
  readonly hostnames = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];

  matches(url: URL): boolean {
    return this.hostnames.includes(url.hostname);
  }

  async listTracks(): Promise<SubtitleTrack[]> {
    const pr = readPlayerResponse();
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || tracks.length === 0) {
      throw new Error('无法获取字幕信息：该视频可能没有字幕，或页面数据尚未加载完成。');
    }
    return tracks.map((t) => ({
      lang: t.languageCode,
      label: trackLabel(t),
      auto: t.kind === 'asr',
      sourceUrl: t.baseUrl,
      cues: [],
    }));
  }

  async fetchTrackContent(track: SubtitleTrack): Promise<SubtitleCue[]> {
    const videoId = new URLSearchParams(location.search).get('v') ?? '';

    // 1. 已有 pot URL（播放器此前已请求过字幕）→ 直接复用
    const existingPot = await queryPotUrl(videoId);
    if (existingPot) {
      const cues = await fetchViaPotUrl(existingPot, track);
      if (cues) return cues;
    }

    // 2. 无 pot URL → 开启字幕触发播放器请求，再轮询捕获
    ensureCaptionsEnabled();
    const potUrl = await waitForPotUrl(videoId);
    if (potUrl) {
      const cues = await fetchViaPotUrl(potUrl, track);
      if (cues) return cues;
    }

    // 3. 兜底：无 pot 要求的轨道直接抓（已基本绝迹）
    if (track.sourceUrl && !track.sourceUrl.includes('exp=xpe')) {
      return parseTimedText(await fetchTimedText(track.sourceUrl));
    }

    throw new Error('未能获取字幕。请确认视频正在播放且已开启字幕(CC)，然后重试。');
  }
}

/** 注册 YouTube 适配器 */
export function registerYoutubeAdapter(): void {
  siteAdapterRegistry.register(new YoutubeAdapter());
}
