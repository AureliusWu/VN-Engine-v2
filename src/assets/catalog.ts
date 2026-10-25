export type AssetKind = 'background' | 'portrait' | 'cg' | 'audio' | 'font';
export type Asset = { id: string; kind: AssetKind; src: string; alt?: string; sha256?: string; license?: { name: string; src: string } };

export function localAssetPath(path: string): boolean {
  return typeof path === 'string' && !!path && !/^[a-z][a-z0-9+.-]*:/i.test(path)
    && !/[\\%?#\u0000-\u001f]/.test(path) && !path.startsWith('/')
    && !path.split('/').some(segment => !segment || segment === '.' || segment === '..');
}

/** Runtime paths are local and independent of a game's deployment subdirectory. */
export class AssetCatalog {
  private entries = new Map<string, Asset>();
  private urls = new Map<string, string>();
  private readonly baseHref: string;
  get baseURL(): URL { return new URL(this.baseHref); }
  constructor(assets: readonly Asset[], baseURL: string | URL, resolveURL?: (path: string) => string) {
    const base = new URL(baseURL); this.baseHref = base.href;
    if (!['http:', 'https:', 'file:'].includes(base.protocol) || !base.pathname.endsWith('/')) throw new Error('Asset base must be a directory URL');
    for (const asset of assets) {
      if (!asset.id || this.entries.has(asset.id) || !['background', 'portrait', 'cg', 'audio', 'font'].includes(asset.kind)
        || !localAssetPath(asset.src) || (asset.license && (!asset.license.name || !localAssetPath(asset.license.src)))
        || (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(asset.sha256))) throw new Error('Invalid asset manifest');
      const url = new URL(resolveURL ? resolveURL(asset.src) : new URL(asset.src, base).href);
      if (!['http:', 'https:', 'file:', 'blob:'].includes(url.protocol)) throw new Error('Unsupported resolved asset URL');
      this.entries.set(asset.id, this.copy(asset)); this.urls.set(asset.id, url.href);
    }
  }
  private copy(asset: Asset): Asset { return { ...asset, ...(asset.license ? { license: { ...asset.license } } : {}) }; }
  private require(id: string, kind?: AssetKind): Asset {
    const asset = this.entries.get(id);
    if (!asset || (kind && asset.kind !== kind)) throw new Error(`Unknown or mismatched asset: ${id}`);
    return asset;
  }
  get(id: string, kind?: AssetKind): Asset { return this.copy(this.require(id, kind)); }
  url(id: string, kind?: AssetKind): string { this.require(id, kind); return this.urls.get(id)!; }
  list(): Asset[] { return [...this.entries.values()].map(asset => this.copy(asset)); }
}
