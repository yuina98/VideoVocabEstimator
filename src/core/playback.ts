import type { SubtitleCue } from './types.js';

/** 播放倍速的合理范围（下限防止低于实际可听，上限防止失控） */
export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 3;

/**
 * 计算字幕的自然语速（词/分钟）。
 * 分母取字幕 cue 覆盖的总时长（分钟），即实际"说话"时间，
 * 比整段视频时长更贴合说话速率。
 */
export function naturalWpm(cues: SubtitleCue[]): number {
  let words = 0;
  let seconds = 0;
  for (const c of cues) {
    const text = c.text.trim();
    if (!text) continue;
    words += text.split(/\s+/).length;
    seconds += Math.max(0, c.end - c.start);
  }
  if (seconds <= 0 || words === 0) return 0;
  return words / (seconds / 60);
}

/**
 * 目标 WPM -> 播放倍速；目标或自然语速无效、或计算出的倍速超出
 * [MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE] 范围时返回 null（不调整速度，
 * 避免字幕异常）。
 */
export function rateForWpm(targetWpm: number, natural: number): number | null {
  if (!Number.isFinite(targetWpm) || targetWpm <= 0) return null;
  if (!Number.isFinite(natural) || natural <= 0) return null;
  const rate = targetWpm / natural;
  if (rate < MIN_PLAYBACK_RATE || rate > MAX_PLAYBACK_RATE) return null;
  return rate;
}
