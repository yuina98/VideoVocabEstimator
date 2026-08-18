import type { DictionaryMeta } from './types.js';

/**
 * 扩展统一消息类型。
 * popup -> background：词典设置
 * content -> background：字幕抓取（走后台可绕过页面 CORS）、查询已捕获的 pot URL、
 * 设置播放速度（以 MAIN world 调用播放器 API，走 YouTube 原生变速保证音质）
 */
export type ExtensionRequest =
  | { type: 'GET_STATE' }
  | { type: 'SET_ACTIVE_DICTIONARY'; id: string }
  | { type: 'FETCH_SUBTITLE'; url: string }
  | { type: 'GET_POT_URL'; videoId: string }
  | { type: 'SET_PLAYBACK_RATE'; rate: number };

export type ExtensionResponse =
  | { type: 'STATE'; dictionaries: DictionaryMeta[]; activeId: string }
  | { type: 'SET_OK'; id: string }
  | { type: 'FETCH_SUBTITLE_RESULT'; status: number; text: string }
  | { type: 'POT_URL_RESULT'; url: string | null }
  | { type: 'RATE_SET' }
  | { type: 'ERROR'; message: string };
