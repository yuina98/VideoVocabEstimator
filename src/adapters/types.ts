import type { SubtitleCue, SubtitleTrack } from '../core/types.js';

/**
 * 站点适配器接口。
 *
 * 未来接入新网站(如 Bilibili)时，实现该接口并注册到
 * `siteAdapterRegistry` 即可，content script 无需改动。
 */
export interface SiteAdapter {
  /** 唯一标识，如 'youtube' */
  readonly id: string;
  /** 该适配器覆盖的主机名 */
  readonly hostnames: string[];
  /** 当前 URL 是否适用 */
  matches(url: URL): boolean;
  /** 列出当前视频可用字幕轨道（只含元信息，不抓内容） */
  listTracks(): Promise<SubtitleTrack[]>;
  /** 获取某条轨道的内容（按需调用，避免浪费请求） */
  fetchTrackContent(track: SubtitleTrack): Promise<SubtitleCue[]>;
}
