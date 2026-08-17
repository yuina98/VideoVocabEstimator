import type { SiteAdapter } from './types.js';

class SiteAdapterRegistryImpl {
  private readonly adapters = new Map<string, SiteAdapter>();

  register(adapter: SiteAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`站点适配器已注册: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /** 按 URL 解析出适配器；无匹配返回 null */
  resolve(url: URL): SiteAdapter | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.matches(url)) return adapter;
    }
    return null;
  }

  list(): SiteAdapter[] {
    return [...this.adapters.values()];
  }
}

/** 全局站点适配器注册表单例 */
export const siteAdapterRegistry = new SiteAdapterRegistryImpl();
