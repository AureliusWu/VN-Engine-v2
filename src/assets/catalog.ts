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
  readonly baseURL: URL;
  constructor(assets: readonly Asset[], baseURL: string | URL) {
    this.baseURL = new URL(baseURL);
    if (!['http:', 'https:', 'file:'].includes(this.baseURL.protocol) || !this.baseURL.pathname.endsWith('/')) throw new Error('Asset base must be a directory URL');
    for (const asset of assets) {
      if (!asset.id || this.entries.has(asset.id) || !['background', 'portrait', 'cg', 'audio', 'font'].includes(asset.kind)
        || !localAssetPath(asset.src) || (asset.license && (!asset.license.name || !localAssetPath(asset.license.src)))
        || (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(asset.sha256))) throw new Error('Invalid asset manifest');
      this.entries.set(asset.id, { ...asset });
    }
  }
  get(id: string, kind?: AssetKind): Asset {
    const asset = this.entries.get(id);
    if (!asset || (kind && asset.kind !== kind)) throw new Error(`Unknown or mismatched asset: ${id}`);
    return { ...asset };
  }
  url(id: string, kind?: AssetKind): string { return new URL(this.get(id, kind).src, this.baseURL).href; }
  list(): Asset[] { return [...this.entries.values()].map(asset => ({ ...asset })); }
}
